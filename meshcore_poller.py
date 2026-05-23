import asyncio
import re
import logging
import time
import urllib.request
from collections import deque
from meshcore import MeshCore, EventType

from config import Config
from data_store import DataStore

logger = logging.getLogger("meshcore_poller")


class MeshcorePoller:
    """
    Connects to a MeshCore companion device over TCP and polls
    configured repeaters on a staggered schedule.

    Reads config dynamically each cycle so web UI changes
    (companion IP, repeater list, timing) take effect without restart.
    """

    def __init__(self, store: DataStore, cfg: Config):
        self.store = store
        self._cfg = cfg
        self.mc: MeshCore = None
        self._running = False
        self._contacts = {}
        self._current_host = None
        self._current_port = None
        self._needs_reconnect = False
        self._stay_disconnected = False
        self._msg_sub_contact = None
        self._msg_sub_channel = None
        self._msg_sub_ack = None
        self._device_channels: list = []  # [{name, idx}] fetched from node
        self._companion_battery_mv: int = 0  # battery of the companion WiFi node itself
        self._last_connected_ts: float = (
            0  # unix timestamp of last confirmed connection
        )
        self._path_sub = None  # passive PATH_RESPONSE subscription
        self._rx_log_sub = None  # all LoRa packets heard — SNR/RSSI/type
        self._advert_sub = None  # node advertisement beacons
        self._telemetry_sub = None  # companion base telemetry (battery)
        self._recent_events: deque = deque(maxlen=200)  # live mesh activity feed
        self._node_id_name_cache: dict = (
            self.store.load_node_names()
        )  # pubkey first-byte (2 hex chars) → node name
        self._contact_routes: dict = (
            {}
        )  # pubkey_prefix (upper) → (hops, route_path) for all contacts
        self._msg_drained = False
        self._dont_save_contact_msgs = (
            False  # Don't save app command replies to private messages
        )

    def _cache_node_name(self, pubkey_prefix: str, name: str):
        """Store a node ID → name mapping and persist it to the database."""
        pubkey_prefix = pubkey_prefix.lower()[:12]
        if self._node_id_name_cache.get(pubkey_prefix) == name:
            return  # no change, skip write
        self._node_id_name_cache[pubkey_prefix] = name
        self.store.save_node_names({pubkey_prefix: name})

    def _get_cached_node_name(self, node_id):
        # If we get a request with an id smaller than 12 we return the first match.
        # This is for supporting pathing on smaller packet hops (e.g 2 char)
        node_id_lower = node_id[:12].lower()
        for k, name in self._node_id_name_cache.items():
            if k.startswith(node_id_lower) or node_id_lower.startswith(k):
                return name
        return None

    @property
    def is_connected(self) -> bool:
        return self.mc is not None and getattr(self.mc, "is_connected", False)

    @property
    def device_channels(self) -> list:
        return list(self._device_channels)

    async def start(self):
        """Main entry point. Runs forever, reconnecting on errors."""
        self._running = True

        # Register any initially configured repeaters
        self.store.init_repeaters()
        self.load_stored_contact_routes()

        while self._running:
            if self._stay_disconnected:
                await asyncio.sleep(1)
                continue
            try:
                self._msg_drained = False
                await self._connect()
                await self._poll()
            except Exception as e:
                logger.error(f"Poller error: {e}", exc_info=True)
                if self.mc:
                    try:
                        await self.mc.disconnect()
                    except Exception:
                        pass
                    self.mc = None
                if self._stay_disconnected:
                    continue
                logger.info("Reconnecting in 10 seconds...")
                await asyncio.sleep(10)

    async def stop(self):
        self._running = False
        if self.mc:
            try:
                await self.mc.disconnect()
            except Exception:
                pass

    def request_reconnect(self):
        """Called by the web API when settings change or user clicks Connect."""
        self._stay_disconnected = False
        self._needs_reconnect = True

    def manual_disconnect(self):
        """Disconnect and don't auto-reconnect until the user clicks Connect."""
        self._stay_disconnected = True
        self._needs_reconnect = True  # Break the inner poll loop

    def _log_event(self, event_type: str, **data):
        """Append an event to the recent-activity ring buffer."""
        self._recent_events.appendleft({"ts": time.time(), "type": event_type, **data})

    def get_recent_events(self, limit: int = 100) -> list:
        return list(self._recent_events)[:limit]

    async def _connect(self):
        host = self._cfg.companion_host
        port = self._cfg.companion_port
        self._current_host = host
        self._current_port = port
        self._needs_reconnect = False

        if not host:
            return

        try:
            if self._cfg.companion_type == Config.CompanionType.SERIAL_USB:
                logger.info(f"Connecting to companion at {host}")
                self.mc = await MeshCore.create_serial(host)
            else:
                logger.info(f"Connecting to companion at {host}:{port}")
                self.mc = await MeshCore.create_tcp(
                    host,
                    port,
                    auto_reconnect=True,
                    max_reconnect_attempts=5,
                )
        except Exception as e:
            print(f"Connection to companion failed: {e}")
            await asyncio.sleep(10)
            return

        logger.info("Connected to companion device")
        if self.mc and hasattr(self.mc, "self_info") and self.mc.self_info:
            logger.info(f"Self info: {self.mc.self_info}")
        else:
            logger.info("Self info not available after connect")

        await self._refresh_contacts()
        await self._fetch_device_channels()
        await self._fetch_companion_telemetry()
        await self._subscribe_messages()

    async def _poll(self):
        while (
            self._running and not self._needs_reconnect and not self._stay_disconnected
        ):
            # Re-read config each cycle for dynamic updates
            repeaters = self._cfg.repeaters
            poll_interval = self._cfg.poll_interval_hours * 3600

            # Check if companion IP changed
            new_host = self._cfg.companion_host
            new_port = self._cfg.companion_port
            if new_host != self._current_host or new_port != self._current_port:
                logger.info(
                    f"Companion address changed to {new_host}:{new_port}, reconnecting..."
                )
                break

            if self._cfg.polling_enabled:
                await self._refresh_contacts(silent=True)
                stagger = self._cfg.stagger_delay_seconds
                now_ts = time.time()
                any_polled = False

                for i, repeater_cfg in enumerate(repeaters):
                    if (
                        not self._running
                        or self._needs_reconnect
                        or self._stay_disconnected
                    ):
                        break

                    pubkey = repeater_cfg.pubkey
                    name = repeater_cfg.name

                    rep_state = self.store.get(pubkey)
                    last_poll = rep_state.get("last_poll_timestamp") or 0.0

                    if now_ts < last_poll + poll_interval:
                        continue

                    any_polled = True
                    contact = self._find_contact(pubkey)

                    if contact is None:
                        logger.warning(
                            f"[{name}] No contact found for pubkey {pubkey[:12]}... "
                            f"(is the repeater in range?)"
                        )
                        if i < len(repeaters) - 1:
                            await self._interruptible_sleep(stagger)
                        continue

                    await self._poll_repeater(contact, repeater_cfg)

                    if i < len(repeaters) - 1:
                        logger.debug(f"Waiting {stagger}s before next repeater")
                        await self._interruptible_sleep(stagger)
                if any_polled:
                    await self._fetch_companion_telemetry()
            else:
                logger.debug("Polling paused — skipping this cycle")
        
            await self._interruptible_sleep(30)

        self._unsubscribe_messages()

        # Disconnect before reconnecting with new settings
        if self.mc:
            try:
                await asyncio.wait_for(self.mc.disconnect(), timeout=5)
            except Exception:
                pass
            self.mc = None

    # --- Companion device telemetry (battery) ---

    async def _fetch_companion_telemetry(self):
        """Request battery level from the companion WiFi node."""
        if not self.mc:
            return
        # Update last-connected timestamp whenever we successfully poll
        self._last_connected_ts = time.time()

        try:
            # Try get_bat on the companion
            status = await self.mc.commands.get_bat()
            logger.debug(f"[companion] get_bat returned: {status!r}")
            if status.type != EventType.ERROR and "level" in getattr(
                status, "payload", {}
            ):
                self._companion_battery_mv = int(status.payload["level"])
                logger.debug(
                    f"[companion] battery from status: {self._companion_battery_mv}mV"
                )
                return
        except Exception as e:
            logger.info(f"[companion] get-bat failed: {e}")
        try:
            # Try get_self_telemetry on the companion
            telemetry = await self.mc.commands.get_self_telemetry()
            logger.debug(f"[companion] get_self_telemetry returned: {telemetry!r}")
            sensors = telemetry if isinstance(telemetry, list) else []
            for sensor in sensors:
                sensor_type = sensor.get("type", "")
                value = sensor.get("value")
                ch = sensor.get("channel", -1)
                if sensor_type == "voltage" and value is not None:
                    self._companion_battery_mv = int(float(value) * 1000)
                    return
                elif sensor_type == "analog" and ch == 1 and value is not None:
                    self._companion_battery_mv = int(float(value) * 1000)
                    return
        except Exception as e:
            logger.info(f"[companion] get_self_telemetry failed: {e}")

    # --- Device channel discovery ---

    async def _fetch_device_channels(self):
        """Query the node for configured channels (indices 0-7)."""
        channels = []
        for idx in range(8):
            try:
                result = await self.mc.commands.get_channel(idx)
                if result.type == EventType.ERROR:
                    continue
                payload = result.payload if hasattr(result, "payload") else {}
                if not isinstance(payload, dict):
                    continue
                name = payload.get("channel_name", "").strip("\x00").strip()
                if name:
                    channels.append({"name": name, "idx": idx})
            except Exception:
                break  # If the command isn't supported, stop trying
        self._device_channels = channels
        if channels:
            logger.info(f"Device channels: {[c['name'] for c in channels]}")
        else:
            logger.debug("No device channels found (using settings channels)")

    # --- Message subscription ---

    async def _subscribe_messages(self):
        """Subscribe to incoming message events and start polling for buffered messages."""
        try:
            self._msg_sub_contact = self.mc.subscribe(
                EventType.CONTACT_MSG_RECV, self._on_contact_msg
            )
        except Exception as e:
            logger.warning(f"Could not subscribe to contact messages: {e}")

        try:
            self._msg_sub_channel = self.mc.subscribe(
                EventType.CHANNEL_MSG_RECV, self._on_channel_msg
            )
        except Exception as e:
            logger.warning(f"Could not subscribe to channel messages: {e}")

        try:
            self._msg_sub_ack = self.mc.subscribe(EventType.ACK, self._on_msg_ack)
            logger.debug("Subscribed to ACK events")
        except Exception as e:
            logger.debug(f"ACK events not available: {e}")

        try:
            self._path_sub = self.mc.subscribe(
                EventType.PATH_RESPONSE, self._on_path_response
            )
            logger.debug("Subscribed to passive PATH_RESPONSE events")
        except Exception as e:
            logger.debug(f"PATH_RESPONSE subscription not available: {e}")

        try:
            self._rx_log_sub = self.mc.subscribe(EventType.RX_LOG_DATA, self._on_rx_log)
            logger.debug("Subscribed to RX_LOG_DATA events")
        except Exception as e:
            logger.debug(f"RX_LOG_DATA not available: {e}")

        try:
            self._advert_sub = self.mc.subscribe(
                EventType.ADVERTISEMENT, self._on_advertisement
            )
            logger.debug("Subscribed to ADVERTISEMENT events")
        except Exception as e:
            logger.debug(f"ADVERTISEMENT not available: {e}")

        # Try to subscribe to telemetry/sensor events to get companion battery
        for et_name in (
            "BATTERY",
            "TELEMETRY_RESPONSE",
            "TELEMETRY",
            "SENSOR_DATA",
            "BASE_TELEMETRY",
            "NODE_TELEMETRY",
            "STATUS",
        ):
            try:
                et = getattr(EventType, et_name, None)
                if et is not None:
                    self._telemetry_sub = self.mc.subscribe(
                        et, self._on_companion_telemetry
                    )
                    logger.info(f"[companion] Subscribed to EventType.{et_name}")
                    break
            except Exception as e:
                logger.debug(f"[companion] EventType.{et_name} not available: {e}")

        # Drain any messages buffered on the node since last connect
        await self._drain_messages()

        # Try to enable auto-fetching (some firmware versions support this)
        try:
            logger.info("Auto message fetching started")
            await self.mc.start_auto_message_fetching()
        except Exception as e:
            logger.error("start_auto_message_fetching not available")

    async def _drain_messages(self):
        """Pull all messages currently buffered on the node."""
        try:
            count = 0
            while True:
                result = await self.mc.commands.get_msg(timeout=3)
                if result.type in (
                    EventType.CONTACT_MSG_RECV,
                    EventType.CHANNEL_MSG_RECV,
                ):
                    await self._dispatch_message(result)
                    count += 1
                else:
                    break  # NO_MORE_MSGS or ERROR
            if count:
                logger.info(f"Drained {count} buffered message(s) from node")
            self._msg_drained = True
        except Exception as e:
            logger.error(f"Message drain: {e}")

    def _unsubscribe_messages(self):
        for sub in (
            self._msg_sub_contact,
            self._msg_sub_channel,
            self._msg_sub_ack,
            self._path_sub,
            self._rx_log_sub,
            self._advert_sub,
            self._telemetry_sub,
        ):
            if sub is not None:
                try:
                    self.mc.unsubscribe(sub)
                except Exception:
                    pass
        self._msg_sub_contact = None
        self._msg_sub_channel = None
        self._msg_sub_ack = None
        self._path_sub = None
        self._rx_log_sub = None
        self._advert_sub = None
        self._telemetry_sub = None

    async def _dispatch_message(self, event):
        """Handle a message event from either subscription or polling."""
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            if event.type == EventType.CONTACT_MSG_RECV:
                await self._on_contact_msg(event)
            elif event.type == EventType.CHANNEL_MSG_RECV:
                await self._on_channel_msg(event)
        except Exception as e:
            logger.error(f"Error dispatching message: {e}")

    def __try_get_and_update_timestamp(self, pubkey, payload):
        repeater = self.store.get(pubkey)
        if self._msg_drained and repeater:
            ts = payload.get("timestamp") or payload.get("sender_timestamp")
            if ts:
                self.store.update_repeater_clock(repeater["pubkey"], ts)
                repeater = self.store.get(pubkey)
                logger.info(
                    f"[{repeater.get("name")}] Time offset s: {repeater.get("time_offset_seconds")}"
                )

    async def _on_contact_msg(self, event):
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            text = payload.get("text", "")
            sender_pubkey = str(payload.get("pubkey_prefix", ""))

            # If this matches a repeater then update the clock:
            self.__try_get_and_update_timestamp(sender_pubkey, payload)

            sender_name = self._resolve_contact_name(sender_pubkey)
            hops, path = self._extract_hops_path(payload.get("path_len"), payload.get("path", ""))
            if hops >= 0 and path is not None:
                self.add_to_contact_routes(sender_pubkey, hops, path, reverse=True)

            if hops > 0 and not path and sender_pubkey:
                stored_hops, stored_path = self.store.get_route_by_prefix(sender_pubkey)
                if stored_path and stored_hops == hops:
                    path = stored_path
                if not path:
                    cached_hops, cached_path = self.get_cached_contact_route(
                        sender_pubkey
                    )
                    if cached_hops == hops and cached_path:
                        path = cached_path
                # Still no path — fire-and-forget path discovery so future messages work
                if not path:
                    contact = self._find_contact(sender_pubkey)
                    if contact is not None:
                        asyncio.ensure_future(
                            self._discover_path(
                                contact,
                                sender_pubkey,
                                sender_name,
                                configured_contact=False,
                            )
                        )
            if text:
                is_new = not self._dont_save_contact_msgs and self.store.store_message(
                    "in", None, sender_pubkey, sender_name, text, hops=hops, path=path
                )
                if is_new:
                    logger.info(
                        f"[msg] Direct from {sender_name} ({hops} hops): {text[:60]}"
                    )
                    self._log_event(
                        "contact_msg",
                        sender=sender_name,
                        pubkey=sender_pubkey,
                        hops=hops,
                        path=path,
                        path_chips=self._decode_path_chips(path),
                        text=text[:120],
                    )
                    await self._send_ntfy("MeshCore", f"{sender_name}: {text}")
        except Exception as e:
            logger.error(f"Error handling contact message: {e}")

    async def _on_channel_msg(self, event):
        try:
            # Channel (group) messages don't have sender pubkey.
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            text = payload.get("text", "")
            channel_idx = payload.get("channel_idx", 0)
            ch_name = next(
                (c["name"] for c in self._device_channels if c["idx"] == channel_idx),
                f"Ch{channel_idx}",
            )

            hops, path = self._extract_hops_path(payload.get("path_len"), payload.get("path", ""))
            if text:
                is_new = self.store.store_message(
                    "in",
                    channel_idx,
                    "",
                    ch_name,
                    text,
                    hops=hops,
                    path=path,
                )
                if is_new:
                    logger.info(
                        f"[msg] Channel {channel_idx} ({ch_name}, {hops} hops): {text[:60]}"
                    )
                    self._log_event(
                        "channel_msg",
                        channel=ch_name,
                        channel_idx=channel_idx,
                        sender="Unknown",
                        pubkey="",
                        hops=hops,
                        path=path,
                        path_chips=self._decode_path_chips(path),
                        text=text[:120],
                    )
                    await self._send_ntfy("MeshCore", f"[{ch_name}] {text}")
        except Exception as e:
            logger.error(f"Error handling channel message: {e}")

    async def _send_ntfy(self, title: str, message: str):
        """Fire a push notification via ntfy if a topic is configured and notifications are enabled."""
        s = self._cfg
        if not self._cfg.ntfy_enabled:
            return
        topic = s.ntfy_topic.strip()
        if not topic:
            return
        server = s.ntfy_server.strip().rstrip("/")
        click_url = s.dashboard_url.strip()
        await self._send_ntfy_to(server, topic, title, message, click_url)

    async def _send_ntfy_to(
        self, server: str, topic: str, title: str, message: str, click_url: str = ""
    ):
        """Send a ntfy notification using the headers API (plain text body, metadata in headers)."""
        url = f"{server}/{topic}"
        headers = {
            "Content-Type": "text/plain; charset=utf-8",
            "Title": title,
        }
        if click_url:
            headers["Click"] = click_url
        data = message.encode("utf-8")

        def _post():
            try:
                req = urllib.request.Request(
                    url, data=data, headers=headers, method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                logger.warning(f"ntfy notification failed: {e}")

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _post)

    async def _on_msg_ack(self, event):
        """Handle an ACK event — a node confirmed it heard one of our sent messages."""
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            # The ACK payload contains a code that matches expected_ack from the send result
            code = payload.get(
                "code", payload.get("ack_code", payload.get("expected_ack", b""))
            )
            if isinstance(code, bytes):
                code = code.hex()
            elif not isinstance(code, str):
                code = str(code)
            if code:
                count = self.store.increment_message_acks(code)
                if count > 0:
                    logger.info(f"[msg] ACK received — message seen by {count} node(s)")
                else:
                    logger.debug(
                        f"[msg] ACK received (code={code}) — no matching outgoing message"
                    )
                # Always log to Packets feed so the user can see ACKs arriving
                self._log_event("ack", ack_code=code, seen_by=count)
        except Exception as e:
            logger.debug(f"Error handling ACK event: {e}")

    async def _on_path_response(self, event):
        """Passively capture PATH_RESPONSE events to keep repeater routes fresh."""
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            pubkey_pre = payload.get("pubkey_pre", "")

            # Parse path with the same auto-detect logic used elsewhere
            new_hops, disc_route = self._extract_hops_path(
                payload.get("out_path_len"), payload.get("out_path", "")
            )
            if not pubkey_pre or new_hops < 0:
                return

            if disc_route is not None:
                # Cache for all contacts (used by non-configured contacts too)
                self.add_to_contact_routes(pubkey_pre, new_hops, disc_route)

                # Update configured repeater store if this matches one
                repeater_cfg = self._cfg.get_repeater(pubkey_pre)
                if repeater_cfg:
                    log_pubkey = repeater_cfg.pubkey
                    log_name = repeater_cfg.name
                    self.store.update_route(log_pubkey, new_hops, disc_route)
                else:
                    log_pubkey = pubkey_pre
                    log_name = self._resolve_contact_name(pubkey_pre)
                logger.info(
                    f"[path] Live route update — {log_name}: {new_hops} hop(s), path={disc_route or 'direct'}"
                )
                self._log_event(
                    "path",
                    name=log_name,
                    pubkey=log_pubkey,
                    hops=new_hops,
                    route=disc_route,
                )
        except Exception as e:
            logger.debug(f"Error handling PATH_RESPONSE event: {e}")

    def add_to_contact_routes(
        self, pubkey_prefix, hops, processed_route, increment=True, reverse=False
    ):
        if hops < 0 or (hops > 1 and not processed_route):
            # Bad data, don't store.
            return
        
        # Store everything from companion POV, so for getting paths from remote packets we'll want to 
        # request that be reversed.
        if reverse:
            processed_route = " > ".join(reversed([p.strip() for p in processed_route.split(">")]))

        node_key = pubkey_prefix[:12].lower()
        # Create or increment hop, route counter
        self._contact_routes.setdefault(node_key, {})
        if (hops, processed_route) not in self._contact_routes[node_key]:
            self._contact_routes[node_key][(hops, processed_route)] = 1
        elif increment:
            self._contact_routes[node_key][(hops, processed_route)] += 1

        # Now only keep top 5 routes by frequency, and on tie choose fewest hops
        self._contact_routes[node_key] = dict(
            sorted(
                self._contact_routes[node_key].items(),
                key=lambda a: (-a[1], a[0][0]),
            )[:5]
        )
        n_routes = len(self._contact_routes[node_key].keys())
        max_freq_count = max(self._contact_routes[node_key].values())
        min_freq_count = min(self._contact_routes[node_key].values())

        # Cap the largest value
        if max_freq_count > 5:
            for k in self._contact_routes[node_key].keys():
                self._contact_routes[node_key][k] *= 5 / max_freq_count

        # Finally scale so that the smallest count becomes < 1, this way an old entry is always evicted leaving room
        # for another to get consecutive
        if min_freq_count > 1 and n_routes >= 5:
            for k in self._contact_routes[node_key].keys():
                self._contact_routes[node_key][k] *= 0.9 / min_freq_count

        # If this is an increment call then update store 
        if increment:
            best_hops, best_route = next(iter(self._contact_routes[node_key].keys()))
            if best_hops >= 0 and best_route is not None:
                self.store.update_contact_route(node_key, best_hops, best_route)
    

    def get_cached_contact_route(self, pubkey_prefix):
        node_key = pubkey_prefix[:12].lower()
        if node_key not in self._contact_routes:
            return None, None

        return next(iter(self._contact_routes[node_key].keys()))
    
    def load_stored_contact_routes(self):
        for pubkey, (hops, route) in self.store.read_contact_routes().items():
            self.add_to_contact_routes(pubkey, hops, route, increment=False)

    def get_all_cached_contact_routes_for_display(self):
        all_routes = {}
        for pubkey, routes_dict in self._contact_routes.items():
            hops, route = next(iter(routes_dict.keys()))
            display_route = " > ".join([p.strip()[: self._cfg.node_id_chars] for p in route.split(">")])
            all_routes[pubkey] = {"hops": hops, "path": display_route}
        return all_routes

    # Payload type codes extracted from header byte bits 2-5: (header >> 2) & 0x0F
    _PAYLOAD_TYPE_NAMES = {
        0: "Request",
        1: "Response",
        2: "Text Message",
        3: "ACK",
        4: "Advert",
        5: "Group Text",
        6: "Group Data",
        7: "Anon Request",
        8: "Path Update",
        9: "Trace",
        10: "Multipart",
        11: "Control",
    }

    async def _on_rx_log(self, event):
        """Capture raw RF log events — every LoRa packet the companion hears, with SNR/RSSI."""
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            snr = payload.get("snr")
            rssi = payload.get("rssi")
            route = payload.get("route", payload.get("path", ""))
            raw = payload.get("data", payload.get("payload", ""))
            if isinstance(raw, bytes):
                raw = raw.hex()
            raw_str = str(raw) if raw else ""

            pkt_type_label = ""
            node_label = ""
            decoded_path = []  # list of {"id": "BC", "name": "Solar Pole Node"}

            if len(raw_str) >= 4:
                try:
                    header = int(raw_str[0:2], 16)
                    payload_type = (header >> 2) & 0x0F
                    route_type = header & 0x03  # 0=Direct, 1=Flood, 2=Routed, 3=Reply
                    pkt_type_label = self._PAYLOAD_TYPE_NAMES.get(
                        payload_type, f"Type {payload_type}"
                    )

                    # Bits 0-5 store path hash count / hop count (0-63)
                    # Bits 6-7 store path hash size minus 1
                    hops = self._path_len_to_hops(int(raw_str[2:4]))
                    path_len = int(raw_str[2:4], 16) & 0x1F
                    path_chars = (((int(raw_str[2:4], 16) & 0xC0) >> 6) + 1) * 2
                    payload_hex_start = 4 + path_len * path_chars

                    # Decode each hop in the path
                    for i in range(path_len):
                        hop_hex_pos = 4 + i * path_chars
                        if hop_hex_pos + path_chars > len(raw_str):
                            break
                        hop_id = raw_str[hop_hex_pos : hop_hex_pos + path_chars].lower()
                        hop_name = self._get_cached_node_name(hop_id)
                        decoded_path.append({"id": hop_id, "name": hop_name or hop_id})

                    advert_data = None
                    if payload_type == 4 and len(raw_str) >= payload_hex_start + 218:
                        pl = raw_str[payload_hex_start:]
                        # pubkey: bytes 0-31 (64 hex chars)
                        pubkey_hex = pl[0:64]
                        # timestamp: bytes 32-35 little-endian uint32
                        advert_ts = None
                        if len(pl) >= 72:
                            advert_ts = int.from_bytes(
                                bytes.fromhex(pl[64:72]), "little"
                            )
                        # app_flags: byte 100
                        app_flags = None
                        if len(pl) >= 202:
                            app_flags = int(pl[200:202], 16)
                        # lat/lon: bytes 101-104, 105-108, signed int32 little-endian / 1e7
                        advert_lat = advert_lon = None
                        if len(pl) >= 218:
                            lat_int = int.from_bytes(
                                bytes.fromhex(pl[202:210]), "little", signed=True
                            )
                            lon_int = int.from_bytes(
                                bytes.fromhex(pl[210:218]), "little", signed=True
                            )
                            advert_lat = round(lat_int / 1e6, 6)
                            advert_lon = round(lon_int / 1e6, 6)
                        # name: bytes 109+ (218 hex chars into payload)
                        name_hex = pl[218:] if len(pl) > 218 else ""
                        if len(name_hex) % 2:
                            name_hex = name_hex[:-1]
                        name_str = ""
                        if name_hex:
                            name_bytes = bytes.fromhex(name_hex)
                            null_pos = name_bytes.find(b"\x00")
                            if null_pos >= 0:
                                name_bytes = name_bytes[:null_pos]
                            name_str = name_bytes.decode(
                                "utf-8", errors="ignore"
                            ).strip()
                        if len(name_str) >= 2:
                            node_label = name_str
                            if pubkey_hex:
                                self._cache_node_name(pubkey_hex[:12], name_str)
                                # Persist advert-discovered node to DB for map display
                                self.store.upsert_advert_node(
                                    pubkey=pubkey_hex,
                                    name=name_str,
                                    lat=(
                                        advert_lat
                                        if advert_lat and advert_lat != 0.0
                                        else None
                                    ),
                                    lon=(
                                        advert_lon
                                        if advert_lon and advert_lon != 0.0
                                        else None
                                    ),
                                )
                        advert_data = {
                            "pubkey": pubkey_hex,
                            "ts": advert_ts,
                            "flags": app_flags,
                            "lat": advert_lat,
                            "lon": advert_lon,
                            "name": name_str,
                        }

                        # Use the decoded RF path as a route update for this node
                        if pubkey_hex and path_len >= 0:
                            route_str = " > ".join(h["id"] for h in decoded_path)
                            self.add_to_contact_routes(pubkey_hex, hops, route_str, reverse=True)
                            logger.debug(
                                f"[advert path] {name_str or pubkey_hex[:8]}: hops={hops}, path={'flood' if hops == -1 else route_str or 'direct'}"
                            )

                    # For non-advert or if name not found: use first hop as node label
                    if not node_label and decoded_path:
                        node_label = decoded_path[0]["name"]

                except (ValueError, IndexError):
                    pass

            self._log_event(
                "rx",
                snr=snr,
                rssi=rssi,
                pkt_type=pkt_type_label,
                route=route,
                raw=raw_str,
                node=node_label,
                path=decoded_path,
                direct=route_type != 1,
                advert=advert_data,
            )
        except Exception as e:
            logger.debug(f"Error handling RX_LOG_DATA: {e}")

    async def _on_advertisement(self, event):
        """Handle node advertisement beacons — update name cache only.
        Advert packets appear in the Packets feed via _on_rx_log with decoded name and path.
        """
        try:
            payload = event.payload if hasattr(event, "payload") else {}
            if not isinstance(payload, dict):
                return
            pubkey = payload.get("public_key")
            if pubkey:
                # If this matches a repeater then update the clock:
                self.__try_get_and_update_timestamp(pubkey, payload)
                name = self._resolve_contact_name(pubkey)

                # Cache pubkey first byte → name so _on_rx_log can resolve node IDs
                if len(pubkey) >= 12 and name and name != pubkey[:12]:
                    self._cache_node_name(pubkey[:12], name)
        except Exception as e:
            logger.debug(f"Error handling ADVERTISEMENT: {e}")

    async def _on_companion_telemetry(self, event):
        """Handle telemetry event from the companion node — extract battery."""
        try:
            logger.debug(
                f"[companion] telemetry event: type={getattr(event, 'type', None)!r} event={event!r}"
            )
            bat = None
            # Check direct attributes first (BATTERY event format)
            for attr in ("bat", "bat_mv", "battery", "battery_mv", "voltage", "level"):
                val = getattr(event, attr, None)
                if val is not None:
                    bat = val
                    break
            # Fall back to payload dict
            if bat is None:
                payload = event.payload if hasattr(event, "payload") else {}
                if isinstance(payload, dict):
                    bat = (
                        payload.get("bat")
                        or payload.get("bat_mv")
                        or payload.get("battery")
                        or payload.get("battery_mv")
                        or payload.get("voltage")
                        or payload.get("level")
                    )
            if bat is not None and float(bat) > 0:
                # Values < 10 are likely in volts — convert to mV
                mv = int(float(bat) * 1000) if float(bat) < 10 else int(float(bat))
                self._companion_battery_mv = mv
                logger.debug(f"[companion] battery from telemetry event: {mv}mV")
        except Exception as e:
            logger.info(f"Error handling companion telemetry: {e}")

    def _extract_ack_code(self, send_result) -> str:
        """Extract the expected ACK code from a send_msg / send_chan_msg result."""
        try:
            payload = send_result.payload if hasattr(send_result, "payload") else {}
            if not isinstance(payload, dict):
                return ""
            code = payload.get(
                "expected_ack", payload.get("ack_code", payload.get("code", b""))
            )
            if isinstance(code, bytes):
                return code.hex()
            return str(code) if code else ""
        except Exception:
            return ""

    def _path_len_to_hops(self, path_len):
        try:
            # Ah, so meshcore (C) is 255, meshcore_py alters this to -1
            if path_len == 255 or path_len == -1:
                hops = -1
            else:
                hops = int(path_len) & 0x1F
        except (TypeError, ValueError):
            hops = -1

        return hops

    def _extract_hops_path(self, path_len: str, out_path: str) -> tuple:
        """Extract hop count and route path from a message event payload.
        Returns (hops: int, path: str) — hops is -1 if unknown."""
        hops = self._path_len_to_hops(path_len)
        if hops < 0:
            return -1, None
        path_str = ""
        if out_path and hops > 0:
            # If no spaces, treat as compact hex — segment same way as bytes
            if " " not in out_path and hops > 0:
                chars_per_node = len(out_path) // hops
                if chars_per_node in (2, 4, 6):
                    segs = [
                        out_path[i : i + chars_per_node]
                        for i in range(0, len(out_path), chars_per_node)
                        if len(out_path[i : i + chars_per_node]) == chars_per_node
                    ]
                    path_str = " > ".join(segs)
                else:
                    path_str = None  # unknown format — discard
            else:
                path_str = out_path  # already formatted

        return hops, path_str

    def _decode_path_chips(self, path_str: str) -> list:
        """Convert a path string like 'C2 > 1A > 04' into [{id, name}, ...] using the name cache."""
        if not path_str:
            return []
        chips = []
        for seg in path_str.split(">"):
            seg = seg.strip().lower()
            if not seg:
                continue
            # Use first route entry to determine path hash size
            node_id = seg[: len(seg[0])]
            name = self._get_cached_node_name(node_id)
            # Reduce node id to app setting for display/logging
            chips.append(
                {"id": node_id[: self._cfg.node_id_chars], "name": name or node_id}
            )
        return chips

    def _resolve_contact_name(self, pubkey_prefix: str) -> str:
        if not pubkey_prefix:
            return "Unknown"
        p = pubkey_prefix[:12].lower()
        for key, contact in self._contacts.items():
            kl = key.lower()
            if kl == p or kl.startswith(p) or p.startswith(kl):
                return contact.get("name") or pubkey_prefix[:12]
        return pubkey_prefix[:12]

    async def send_channel_message(self, channel_idx: int, text: str) -> dict:
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}
        try:
            result = await self.mc.commands.send_chan_msg(channel_idx, text)
            if result.type == EventType.ERROR:
                return {"ok": False, "error": str(result.payload)}
            ack_code = self._extract_ack_code(result)
            if not ack_code:
                logger.debug(
                    f"[msg] Send result payload fields: {list(result.payload.keys()) if isinstance(getattr(result, 'payload', None), dict) else result.payload}"
                )
            self.store.store_message(
                "out", channel_idx, "", "", text, ack_code=ack_code
            )
            logger.info(
                f"[msg] Sent to channel {channel_idx} (ack={ack_code or 'none'}): {text[:60]}"
            )
            return {"ok": True}
        except Exception as e:
            logger.error(f"Channel send error: {e}")
            return {"ok": False, "error": str(e)}

    async def send_contact_message(self, pubkey: str, text: str) -> dict:
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}
        contact = self._find_contact(pubkey)
        if contact is None:
            await self._refresh_contacts()
            contact = self._find_contact(pubkey)
        if contact is None:
            return {"ok": False, "error": "Contact not found — may be out of range"}
        try:
            result = await self.mc.commands.send_msg(contact, text)
            if result.type == EventType.ERROR:
                return {"ok": False, "error": str(result.payload)}
            name = contact.get("name", pubkey[:12])
            ack_code = self._extract_ack_code(result)
            if not ack_code:
                logger.debug(
                    f"[msg] Send result payload fields: {list(result.payload.keys()) if isinstance(getattr(result, 'payload', None), dict) else result.payload}"
                )
            self.store.store_message("out", None, pubkey, name, text, ack_code=ack_code)
            logger.info(f"[msg] Sent to {name} (ack={ack_code or 'none'}): {text[:60]}")
            return {"ok": True}
        except Exception as e:
            logger.error(f"Contact send error: {e}")
            return {"ok": False, "error": str(e)}

    # --- Contacts ---

    async def _refresh_contacts(self, silent=False):
        """Fetch contacts from companion to populate routing table."""
        try:
            result = await self.mc.commands.get_contacts()
            if result.type == EventType.ERROR:
                logger.error(f"get_contacts failed: {result.payload}")
                return

            contacts = result.payload
            if isinstance(contacts, dict):
                self._contacts = {k.lower()[:12]: v for k, v in contacts.items()}
            elif isinstance(contacts, list):
                self._contacts = {}
                for c in contacts:
                    pk = c.get("public_key", "")
                    if pk:
                        self._contacts[pk.lower()[:12]] = c

            # Pre-populate node ID → name cache from loaded contacts
            for key, contact in self._contacts.items():
                name = contact.get("adv_name", "") if isinstance(contact, dict) else ""
                hops, route_path = self._extract_hops_path(
                    contact.get("out_path_len"), contact.get("out_path")
                )
                if hops >= 0:
                    self.add_to_contact_routes(key, hops, route_path)

                if key and name and len(key) >= 12:
                    self._cache_node_name(key, name)

            if not silent:
                logger.info(f"Loaded {len(self._contacts)} contacts from companion")
        except Exception as e:
            logger.error(f"Contact refresh failed: {e}")

    def _find_contact(self, pubkey_prefix: str):
        """Find a contact matching the configured pubkey (full or prefix)."""
        lower_pubkey = pubkey_prefix.lower()[:12]
        if lower_pubkey in self._contacts:
            return self._contacts[lower_pubkey]

        for key, contact in self._contacts.items():
            if key.lower() == lower_pubkey:
                return contact
        return None

    def get_mesh_contacts(self) -> list:
        """Return all known mesh contacts (configured + unknown) with GPS and routing data."""
        result = []
        for pk, contact in self._contacts.items():
            lat = contact.get("adv_lat", 0.0) or 0.0
            lon = contact.get("adv_lon", 0.0) or 0.0

            hops, route_path = self._extract_hops_path(
                contact.get("out_path_len"), contact.get("out_path")
            )
            # Fall back to contact route cache from PATH_RESPONSE events
            if route_path is None:
                hops, route_path = self.get_cached_contact_route(pk)

            # Try several possible name fields the meshcore SDK may use
            name = (
                contact.get("name")
                or contact.get("adv_name")
                or contact.get("short_name")
                or contact.get("display_name")
                or ""
            )
            name = (name.strip() if isinstance(name, str) else None) or pk[:12]
            last_seen = contact.get(
                "last_advert", contact.get("last_seen", contact.get("ts", None))
            )
            if last_seen is not None:
                try:
                    last_seen = float(last_seen)
                except (TypeError, ValueError):
                    last_seen = None
            result.append(
                {
                    "pubkey_prefix": pk[:12],
                    "pubkey_short": pk[: self._cfg.node_id_chars],
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "hops": hops,
                    "route_path": route_path,
                    "last_seen": last_seen,
                }
            )
        return result

    async def _interruptible_sleep(self, seconds: float):
        """Sleep for up to `seconds`, waking immediately if a disconnect/reconnect is requested."""
        remaining = seconds
        while (
            remaining > 0
            and self._running
            and not self._needs_reconnect
            and not self._stay_disconnected
        ):
            await asyncio.sleep(min(remaining, 0.5))
            remaining -= 0.5

    async def __repeat_on_failure(
        self, func, f_args, f_kwargs={}, reattempts=2, delay_s=5
    ):
        """
        Repeat a function call until a truthy result is returned, else return False.
        NOTE: Can be interrupted by not _running or _needs_reconnect/_stay_disconnected between reattempts which will return None
        """
        i = 0
        while i < max(reattempts, 0) + 1:
            success = await func(*f_args, **f_kwargs)
            if success:
                return success
            else:
                if (
                    not self._running
                    or self._needs_reconnect
                    or self._stay_disconnected
                ):
                    return None
                else:
                    await self._interruptible_sleep(delay_s)
            i += 1

        return False

    async def _poll_repeater(self, contact, repeater_cfg, manual=False):
        if repeater_cfg.paused:
            return
        pubkey = repeater_cfg.pubkey
        name = repeater_cfg.name
        rep_state = self.store.get(pubkey)

        # Use set value, or if not set discover path.
        use_path = repeater_cfg.path.strip()
        hops = len(use_path.split(","))
        if not use_path:
            route_path = ""
            if isinstance(contact, dict):
                hops, route_path = self._extract_hops_path(
                    contact.get("out_path_len"), contact.get("out_path")
                )
            elif hasattr(contact, "out_path_len"):
                hops, route_path = self._extract_hops_path(
                    contact.out_path_len, contact.out_path
                )
            if route_path is not None:
                self.store.update_route(pubkey, hops, route_path)

            # If we know there are intermediate hops but the contact has no path data,
            # run a path discovery request to find the actual route.
            if hops > 0 and not route_path:
                await self._discover_path(contact, pubkey, name)
                hops, route_path = self.get_cached_contact_route(pubkey)

            if hops >= 0 and route_path is not None:
                use_path = route_path
            else:
                use_path = None

        # Extract GPS coordinates from contact if available
        if isinstance(contact, dict):
            lat = contact.get("adv_lat", 0.0) or 0.0
            lon = contact.get("adv_lon", 0.0) or 0.0
            if lat != 0.0 or lon != 0.0:
                self.store.update_location(pubkey, lat, lon)

        route_desc = use_path if use_path else ("direct" if hops >= 0 else "flood")
        logger.info(f"[{name}] Polling repeater, hops={hops}, route={route_desc}...")

        # Apply custom path if configured, otherwise use flood
        await self._apply_path(contact, pubkey, name, use_path)

        # Login to repeater before requesting data
        success = await self._login_to_repeater(
            repeater_cfg.pubkey, contact, name, repeater_cfg.admin_pass
        )
        if success:
            if not self._running or self._needs_reconnect or self._stay_disconnected:
                return
            await self.__repeat_on_failure(
                self._request_status, [pubkey, name, contact]
            )
        if success:
            if not self._running or self._needs_reconnect or self._stay_disconnected:
                return
            await self.__repeat_on_failure(
                self._request_telemetry, [pubkey, name, contact]
            )
        # Get neighbours if needed
        if (
            success
            and self._cfg.neighbours_enabled
            and (
                manual
                or time.time()
                >= rep_state["last_neighbour_poll"]
                + self._cfg.neighbours_check_hours * 60 * 60
            )
        ):
            if not self._running or self._needs_reconnect or self._stay_disconnected:
                return
            await self.__repeat_on_failure(
                self._request_neighbours, [pubkey, name, contact]
            )
        # Get FW if needed
        # NOTE: We use the timestamp on the returned packet to validate clock at the same time rather
        # than doing a separate query.
        if success and (
            manual
            or (
                self._cfg.firmware_get_enabled
                and time.time()
                >= rep_state["last_fw_poll"]
                + self._cfg.firmware_get_days * 60 * 60 * 24
            )
        ):
            if not self._running or self._needs_reconnect or self._stay_disconnected:
                return
            await self.__repeat_on_failure(
                self._request_version, [pubkey, name, contact]
            )

        # Note: Success could be 'None' if required to abort between attempts due to running/reconnect/etc.
        if success is False:
            logger.debug("Maximum reattempts exceeded, aborting")
            self.store.mark_poll_failed(pubkey)
            return

    async def _discover_path(
        self, contact, pubkey: str, name: str, configured_contact=True
    ):
        """Run a path discovery request to determine the actual route to a repeater.
        OR with configured_contact=False to save as a non-configured contact instead."""
        try:
            result = await self.mc.commands.send_path_discovery_sync(contact)
            if result == None:
                logger.debug(f"[{name}] Path discovery send failed")
                return -1, None
            # Wait up to 10s for the PATH_RESPONSE event
            response = await self.mc.wait_for_event(
                EventType.PATH_RESPONSE,
                attribute_filters={"pubkey_pre": pubkey[:12]},
                timeout=10,
            )
            if response is None:
                logger.debug(f"[{name}] Path discovery timed out")
                return -1, None
            payload = response.payload
            new_hops, disc_route = self._extract_hops_path(
                payload.get("out_path_len"), payload.get("out_path")
            )
            if new_hops >= 0 and disc_route is not None:
                # Add to route ranker list and get best result before saving
                self.add_to_contact_routes(pubkey, new_hops, disc_route)
                if configured_contact:
                    use_hops, use_route = self.get_cached_contact_route(pubkey)
                    self.store.update_route(pubkey, use_hops, use_route)

                logger.info(
                    f"[{name}] Path discovered: hops={new_hops}, path={disc_route or 'direct'}"
                )
                self._log_event(
                    "path", name=name, pubkey=pubkey, hops=new_hops, route=disc_route
                )
            return new_hops, disc_route
        except Exception as e:
            logger.debug(f"[{name}] Path discovery error: {e}")

    async def _apply_path(
        self, contact, pubkey: str, name: str, custom_path: str | None
    ):
        """Apply a custom route path or reset to flood if empty."""
        try:
            if custom_path is not None:
                # Convert to bytes (fromhex ignores spaces) and back to string to clean.
                # NOTE: As of 2.3.0 this method will throw if you send bytes
                if custom_path.strip() == "":
                    await self.mc.commands.change_contact_path(contact, "")
                else:
                    path_hash_mode = None
                    segments = [
                        a.strip()
                        for a in re.split(r"[,;> ]", custom_path)
                        if a and a.strip()
                    ]
                    if segments:
                        path_hash_mode = int(len(segments[0]) / 2) - 1
                    path_bytes = bytes.fromhex(
                        custom_path.replace(",", "").replace(">", "")
                    )
                    await self.mc.commands.change_contact_path(
                        contact, path_bytes.hex(), path_hash_mode
                    )
                logger.info(f"[{name}] Set custom path: {custom_path}")
            else:
                # Whereas this expects bytes (IIRC it may cast if necessary)
                await self.mc.commands.reset_path(bytes.fromhex(pubkey))
                logger.debug(f"[{name}] Using flood routing")
        except Exception as e:
            logger.error(f"[{name}] Path update error: {e}")

    async def _login_to_repeater(self, pubkey, contact, name: str, password: str):
        """Login to a repeater so it responds to status/telemetry requests."""
        try:
            result = await self.__repeat_on_failure(
                self.mc.commands.send_login_sync, [contact, password]
            )
            if result is None:
                logger.warning(f"[{name}] Login failed")
                return False
            else:
                self.store.update_last_logged_in(pubkey)
                logger.info(
                    f"[{name}] Login sent (pwd={'default' if password == 'password' else 'custom'})"
                )
                return True
        except Exception as e:
            logger.error(f"[{name}] Login error: {e}")
            return False

    async def _request_status(self, pubkey: str, name: str, contact):
        """Request status from a repeater and update the store."""
        try:
            status = await self.mc.commands.req_status_sync(contact, timeout=30)
            if status is None:
                logger.warning(f"[{name}] Status request timed out")
                return False

            updates = {}

            if "bat" in status:
                updates["battery_mv"] = status["bat"]
                updates["battery_voltage"] = status["bat"] / 1000.0

            if "last_rssi" in status:
                updates["rssi"] = status["last_rssi"]

            if "last_snr" in status:
                snr_raw = status["last_snr"]
                if isinstance(snr_raw, int) and abs(snr_raw) > 50:
                    updates["snr"] = snr_raw / 4.0
                else:
                    updates["snr"] = float(snr_raw)

            if "noise_floor" in status:
                updates["noise_floor"] = status["noise_floor"]

            if "uptime" in status:
                updates["uptime_seconds"] = status["uptime"]

            if "nb_recv" in status:
                updates["packets_recv"] = status["nb_recv"]
            if "nb_sent" in status:
                updates["packets_sent"] = status["nb_sent"]

            if updates:
                self.store.update_repeater(pubkey, **updates)
                logger.info(
                    f"[{name}] Status: {updates.get('battery_mv', '?')}mV, "
                    f"RSSI={updates.get('rssi', '?')}dBm, "
                    f"SNR={updates.get('snr', '?')}dB"
                )
            return True

        except Exception as e:
            logger.error(f"[{name}] Status request error: {e}")
            return False

    async def _request_telemetry(self, pubkey: str, name: str, contact):
        """Request LPP telemetry and update the store with any extra data."""
        try:
            telemetry = await self.mc.commands.req_telemetry_sync(contact, timeout=30)
            if telemetry is None:
                logger.debug(f"[{name}] Telemetry request returned no data")
                return False

            updates = {}
            sensors = telemetry if isinstance(telemetry, list) else []
            for sensor in sensors:
                sensor_type = sensor.get("type", "")
                value = sensor.get("value")

                if sensor_type == "voltage" and value is not None:
                    updates["battery_voltage"] = float(value)
                    updates["battery_mv"] = int(float(value) * 1000)
                elif sensor_type == "analog" and value is not None:
                    if sensor.get("channel") == 0:
                        updates["battery_voltage"] = float(value)
                        updates["battery_mv"] = int(float(value) * 1000)
                elif sensor_type == "temperature" and value is not None:
                    updates["temperature"] = float(value)
                elif sensor_type == "humidity" and value is not None:
                    updates["humidity"] = float(value)

            if updates:
                self.store.update_repeater(pubkey, **updates)
                logger.info(f"[{name}] Telemetry: {updates}")

            return True
        except Exception as e:
            logger.error(f"[{name}] Telemetry request error: {e}")
            return False

    async def _request_neighbours(self, pubkey: str, name: str, contact):
        """Request neighbours and update the store with results."""
        try:
            if contact and contact.get("type") == 2:
                result = await self.mc.commands.req_neighbours_sync(contact, timeout=30)
                if result == None:
                    logger.debug(f"[{name}] Neighbours request failed")
                    return False

                self.store.save_neighbours(pubkey, result["neighbours"])
                return True
            else:
                logger.debug(f"[{name}] Neighbours only supported by repeater FW")
            return True
        except Exception as e:
            logger.error(f"[{name}] Neighbours request error: {e}")
            return False

    async def _sync_request_remote_cmd(
        self, pubkey: str, command: str, validator_func, contact, timeout=15
    ):
        loop = asyncio.get_running_loop()
        future = loop.create_future()

        def on_event(event_data):
            if future.done():
                return
            # Use the provided callback to check the data
            # If it returns True, we've found our target message and can return.
            if validator_func is None or validator_func(event_data):
                loop.call_soon_threadsafe(future.set_result, event_data)

        sub = self.mc.subscribe(
            EventType.CONTACT_MSG_RECV,
            on_event,
            attribute_filters={"pubkey_prefix": pubkey[:12]},
        )
        try:
            async with self.mc.commands._mesh_request_lock:
                self._dont_save_contact_msgs = True
                await self.mc.commands.send_cmd(contact, command)
                result_data = await asyncio.wait_for(future, timeout=timeout)
                self._dont_save_contact_msgs = False
            return result_data

        except asyncio.TimeoutError:
            if not future.done():
                future.cancel()
            return None

        finally:
            # 5. Clean up the subscriber
            self.mc.unsubscribe(sub)
            self._dont_save_contact_msgs = False

    async def _request_version(self, pubkey: str, name: str, contact):
        """Request version / fw info"""
        try:

            def validator(event):
                return (
                    event.type == EventType.CONTACT_MSG_RECV
                    and "text" in event.payload
                    and event.payload["text"].startswith("v")
                )

            result = await self._sync_request_remote_cmd(
                pubkey, "ver", validator, contact
            )
            if result is None:
                logger.debug(f"[{name}] Firmware version request failed")
                return False

            self.store.save_version_info(pubkey, result.payload["text"])
            logger.debug(f"[{name}] Firmware version is {result.payload["text"]}")

            return True
        except Exception as e:
            logger.error(f"[{name}] FW version request error: {e}")
            return False

    async def get_repeater_contact_and_config(self, pubkey: str) -> tuple:
        contact = self._find_contact(pubkey)
        repeater_cfg = None
        error = ""

        if contact is None:
            await self._refresh_contacts()
            contact = self._find_contact(pubkey)
            if contact is None:
                error += "Repeater not found in contacts — may be out of range. "

        repeater_cfg = self._cfg.get_repeater(pubkey)
        if repeater_cfg is None:
            error += "Pubkey does not match any known repeaters."

        return contact, repeater_cfg, error

    async def ping_repeater(self, pubkey: str) -> dict:
        """Request fresh status and telemetry from a repeater, updating the store."""
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}

        contact, repeater_cfg, error = await self.get_repeater_contact_and_config(
            pubkey
        )
        if error:
            return {"ok": False, "error": error}

        name = repeater_cfg.name or pubkey[:12]
        start = time.monotonic()
        try:
            await self._poll_repeater(contact, repeater_cfg, manual=True)
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info(f"[{name}] Manual refresh completed in {latency_ms}ms")
            return {"ok": True, "latency_ms": latency_ms}
        except Exception as e:
            logger.error(f"[{name}] Manual refresh error: {e}")
            return {"ok": False, "error": str(e)}

    async def send_advert(self, pubkey: str) -> dict:
        """Login to a repeater and command it to broadcast a flood advertisement."""
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}

        contact, repeater_cfg, error = await self.get_repeater_contact_and_config(
            pubkey
        )
        if error:
            return {"ok": False, "error": error}

        name = repeater_cfg.name or pubkey[:12]
        try:
            success = await self._login_to_repeater(
                repeater_cfg.pubkey, contact, name, repeater_cfg.admin_pass
            )
            if not success:
                return {"ok": False, "error": f"Failed to log in to {name}"}

            result = await self._sync_request_remote_cmd(
                pubkey, f"advert", lambda a: True, contact, timeout=10
            )
            if result is None:
                return {"ok": False, "error": f"Filed to send advert, timed out)"}
            return {"ok": True, "text": result.payload["text"]}
        except Exception as e:
            logger.error(f"[{name}] Failed to send advert: {e}")
            return {"ok": False, "error": str(e)}

    async def set_clock(self, pubkey: str) -> dict:
        """Login to a repeater and set the clock using system clock."""
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}

        contact, repeater_cfg, error = await self.get_repeater_contact_and_config(
            pubkey
        )
        if error:
            return {"ok": False, "error": error}

        name = repeater_cfg.name or pubkey[:12]
        try:
            success = await self._login_to_repeater(
                repeater_cfg.pubkey, contact, name, repeater_cfg.admin_pass
            )
            if not success:
                return {"ok": False, "error": f"Failed to log in to {name}"}

            result = await self._sync_request_remote_cmd(
                pubkey,
                f"time {int(time.time() + 0.5)}",
                lambda a: True,
                contact,
                timeout=10,
            )
            if result is None:
                return {"ok": False, "error": f"Clock set timed out)"}
            return {"ok": True, "text": result.payload["text"]}
        except Exception as e:
            logger.error(f"[{name}] Error setting clock: {e}")
            return {"ok": False, "error": f"Error setting clock: {e}"}

    async def cli_login(self, pubkey: str) -> dict:
        """Login to a repeater for manual commands."""
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}

        contact, repeater_cfg, error = await self.get_repeater_contact_and_config(
            pubkey
        )
        if error:
            return {"ok": False, "error": error}

        name = repeater_cfg.name or pubkey[:12]
        try:
            success = await self._login_to_repeater(
                repeater_cfg.pubkey, contact, name, repeater_cfg.admin_pass
            )
            if not success:
                return {"ok": False, "error": f"Failed to log in to {name}"}
            logger.info(f"[{name}] CLI login successful")
            return {"ok": True}
        except Exception as e:
            logger.error(f"[{name}] CLI failed to log in: {e}")
            return {"ok": False, "error": str(e)}

    async def cli_cmd(self, pubkey: str, cmd: str) -> dict:
        """Send the user's manual input command to repeater and wait for response."""
        if not self.mc:
            return {"ok": False, "error": "Not connected to companion device"}

        contact, repeater_cfg, error = await self.get_repeater_contact_and_config(
            pubkey
        )
        if error:
            return {"ok": False, "error": error}

        name = repeater_cfg.name or pubkey[:8]
        try:

            def validator(event):
                return (
                    event.type == EventType.CONTACT_MSG_RECV and "text" in event.payload
                )

            self.store.save_repeater_command_message(repeater_cfg.pubkey, True, cmd)
            result = await self._sync_request_remote_cmd(
                pubkey, cmd, validator, contact, timeout=10
            )
            if cmd.lower().strip() in [
                "reboot",
                "clkreboot",
                "poweroff",
                "shutdown",
            ]:
                # Clear last login time
                self.store.update_last_logged_in(repeater_cfg.pubkey, 0)
                return {"ok": True, "text": f"({cmd} does not return anything)"}

            if result is None:
                return {"ok": False, "error": f"({cmd} timed out)"}

            self.store.save_repeater_command_message(
                repeater_cfg.pubkey, False, result.payload["text"]
            )
            return {"ok": True, "text": result.payload["text"]}
        except Exception as e:
            logger.error(f"[{name}] CLI command error: {e}")
            return {"ok": False, "error": f"CLI command error: {e}"}
