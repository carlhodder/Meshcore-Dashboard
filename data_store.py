import time
import logging
import numbers
import threading
from collections import OrderedDict
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from typing import Dict, List
import peewee
from peewee import (
    CompositeKey,
    Proxy,
    Model,
    FloatField,
    TextField,
    IntegerField,
    BooleanField,
    AutoField,
    SQL,
    fn,
)
from playhouse.migrate import SqliteMigrator, migrate
from playhouse.shortcuts import model_to_dict
from playhouse.sqliteq import SqliteQueueDatabase

db = Proxy()


class BaseDbModel(Model):
    class Meta:
        database = db


###### DEPRECATED ######
class TelemetryLog(BaseDbModel):
    id = AutoField()
    timestamp = FloatField()
    pubkey = TextField()
    name = TextField(null=True)
    battery_mv = IntegerField(null=True)
    battery_voltage = FloatField(null=True)
    rssi = IntegerField(null=True)
    snr = FloatField(null=True)
    uptime_seconds = IntegerField(null=True)

    class Meta:
        table_name = "telemetry_log"
        indexes = ((("pubkey", "timestamp"), False),)


class Measurement(BaseDbModel):
    id = AutoField()
    timestamp = FloatField(null=False, index=True)
    pubkey = TextField(null=False, index=True)
    measurement_code = TextField(null=False, index=True)
    measurement_value = FloatField(null=False)


class Neighbour(BaseDbModel):
    timestamp = FloatField(null=False)
    pubkey = TextField(null=False)
    pubkey_remote = TextField(null=False)
    snr = FloatField(null=False)

    class Meta:
        table_name = "neighbours"
        primary_key = CompositeKey("timestamp", "pubkey", "pubkey_remote")


class ActivityLog(BaseDbModel):
    id = AutoField()
    timestamp = FloatField(index=True)
    level = TextField()
    logger = TextField()
    message = TextField()

    class Meta:
        table_name = "activity_log"


class Message(BaseDbModel):
    id = AutoField()
    timestamp = FloatField(index=True)
    direction = TextField()
    channel_idx = IntegerField(null=True)
    sender_pubkey = TextField(null=True)
    sender_name = TextField(null=True)
    text = TextField()
    hops = IntegerField(default=-1, null=True)
    path = TextField(default="", null=True)
    ack_code = TextField(default="", null=True)
    acks = IntegerField(default=0, null=True)

    class Meta:
        table_name = "messages"
        indexes = [
            SQL(
                "CREATE INDEX IF NOT EXISTS idx_messages_ack_code ON messages (ack_code) WHERE ack_code != ''"
            )
        ]


class RepeaterCommandMessage(BaseDbModel):
    id = AutoField()
    timestamp = FloatField(index=True, null=False)
    pubkey = TextField(null=False, index=True)
    is_command = BooleanField(null=False)
    text = TextField(null=False)

    class Meta:
        table_name = "repeater_command_message"


class NodeName(BaseDbModel):
    node_id = TextField(primary_key=True)
    name = TextField()
    updated = FloatField()

    class Meta:
        table_name = "node_names"


class AdvertNode(BaseDbModel):
    pubkey = TextField(primary_key=True)
    name = TextField()
    lat = FloatField(null=True)
    lon = FloatField(null=True)
    last_seen = FloatField()

    class Meta:
        table_name = "advert_nodes"


# Wrapper just to keep metric field name, label, and default status all in one location.
# Having a metric_label enables logging of the value. Assumes everything isa float atm.
def metric(field, metric_label=None, metric_default=None):
    field.metric_label = metric_label
    field.metric_default = metric_default
    return field


class RepeaterState(BaseDbModel):
    # Fields / db backed current state.
    pubkey = TextField(primary_key=True)
    name = TextField(default="")
    time = FloatField(null=True, default=None)
    time_offset_seconds = metric(
        IntegerField(null=True, default=None), metric_label="Clock offset (s)"
    )
    battery_mv = IntegerField(null=True, default=None)
    battery_voltage = metric(
        FloatField(null=True, default=None),
        metric_label="Battery voltage",
        metric_default=True,
    )
    rssi = metric(
        IntegerField(null=True, default=None),
        metric_label="RSSI (dBm)",
        metric_default=True,
    )
    snr = metric(
        FloatField(null=True, default=None),
        metric_label="SNR (dB)",
        metric_default=True,
    )
    noise_floor = metric(
        IntegerField(null=True, default=None), metric_label="Noise floor (dBm)"
    )
    uptime_seconds = IntegerField(null=True, default=None)
    packets_recv = metric(
        IntegerField(null=True, default=None), metric_label="Packets Rx"
    )
    packets_sent = metric(
        IntegerField(null=True, default=None), metric_label="Packets Tx"
    )
    hops = IntegerField(null=False, default=0)
    route_path = TextField(default="")
    lat = FloatField(null=True, default=None)
    lon = FloatField(null=True, default=None)
    fw_version = TextField(default="")
    last_seen_epoch = FloatField(default=0)
    last_poll_ok = BooleanField(null=True, default=None)
    last_poll_timestamp = FloatField(null=False, default=0)
    last_neighbour_poll = FloatField(null=False, default=0)
    last_fw_poll = FloatField(null=False, default=0)
    last_login_timestamp = FloatField(null=False, default=0)
    temperature = metric(
        FloatField(null=True, default=None), metric_label="Temperature"
    )
    humidity = metric(FloatField(null=True, default=None), metric_label="Humidity")

    @classmethod
    def get_metric_labels_dict(cls) -> dict:
        return {
            k: getattr(f, "metric_label")
            for k, f in cls._meta.fields.items()
            if hasattr(f, "metric_label")
        }

    # Default metrics to show initially
    @classmethod
    def get_default_metric_fields(cls) -> list:
        return [
            name
            for name, field in cls._meta.fields.items()
            if getattr(field, "metric_default", False)
            and getattr(field, "metric_label", None) is not None
        ]

    def to_dict(self) -> dict:
        d = model_to_dict(self)
        d["online"] = self.is_online
        d["pubkey_short"] = self.pubkey[:12] if self.pubkey else ""
        return d

    @property
    def is_online(self) -> bool:
        # Only green when the last poll got a response; red only on explicit failure
        return self.last_poll_ok is True

    class Meta:
        table_name = "repeater_state"


class SQLiteLogHandler(logging.Handler):
    """Logging handler that writes log records to the activity_log SQLite table."""

    def emit(self, record: logging.LogRecord):
        if db.database is not None and record.name != "watchfiles.main":
            try:
                with db.connection_context():
                    ActivityLog.create(
                        timestamp=record.created,
                        level=record.levelname,
                        logger=record.name,
                        message=self.format(record),
                    )
            except Exception:
                self.handleError(record)


class DataStore:
    has_new_message = False

    def __init__(self, cfg):
        self.cfg = cfg
        self._lock = threading.Lock()
        self._repeaters: Dict[str, RepeaterState] = {}
        self._db_path = cfg.history_db if cfg.enable_history else None
        if self._db_path:
            self._init_db()

    def close_db(self):
        if self._db_path and not db.is_closed():
            db.stop()
            db.close()

    def open_db(self):
        if db.obj is None:
            db.initialize(SqliteQueueDatabase(self._db_path, autoconnect=True))
        if db.is_closed():
            db.connect()

    def _init_db(self):
        self.open_db()
        with db.connection_context():
            db.create_tables(
                [
                    TelemetryLog,
                    ActivityLog,
                    Measurement,
                    Message,
                    NodeName,
                    RepeaterState,
                    AdvertNode,
                    Neighbour,
                    RepeaterCommandMessage,
                ],
                safe=True,
            )

            # Preexisting migrations
            migrator = SqliteMigrator(db)
            columns = [col.name for col in db.get_columns("messages")]
            migrations = []

            if "hops" not in columns:
                migrations.append(
                    migrator.add_column(
                        "messages", "hops", IntegerField(default=-1, null=True)
                    )
                )
            if "path" not in columns:
                migrations.append(
                    migrator.add_column(
                        "messages", "path", TextField(default="", null=True)
                    )
                )
            if "ack_code" not in columns:
                migrations.append(
                    migrator.add_column(
                        "messages", "ack_code", TextField(default="", null=True)
                    )
                )
            if "acks" not in columns:
                migrations.append(
                    migrator.add_column(
                        "messages", "acks", IntegerField(default=0, null=True)
                    )
                )

            # New migrations
            if any(
                "logger_name" == c.name
                for c in db.get_columns(ActivityLog._meta.table_name)
            ):
                # Align field names a bit
                migrations.append(
                    migrator.rename_column(
                        ActivityLog._meta.table_name, "logger_name", "logger"
                    )
                )

            if migrations:
                try:
                    print("[DataStore] Migrating...")
                    migrate(*migrations)
                except Exception as e:
                    print(f"[DataStore] Migration error: {e}")
                    return

            # Check if we need to migrate old measurement data
            if TelemetryLog.select().exists() and not Measurement.select().exists():
                for log in TelemetryLog.select().iterator():
                    Measurement.create(
                        timestamp=log.timestamp,
                        pubkey=log.pubkey,
                        measurement_code="battery_mv",
                        measurement_value=log.battery_mv,
                    )
                    Measurement.create(
                        timestamp=log.timestamp,
                        pubkey=log.pubkey,
                        measurement_code="battery_voltage",
                        measurement_value=log.battery_voltage,
                    )
                    Measurement.create(
                        timestamp=log.timestamp,
                        pubkey=log.pubkey,
                        measurement_code="rssi",
                        measurement_value=log.rssi,
                    )
                    Measurement.create(
                        timestamp=log.timestamp,
                        pubkey=log.pubkey,
                        measurement_code="snr",
                        measurement_value=log.snr,
                    )
                    Measurement.create(
                        timestamp=log.timestamp,
                        pubkey=log.pubkey,
                        measurement_code="uptime_seconds",
                        measurement_value=log.uptime_seconds,
                    )

    def init_repeaters(self):
        """Register a repeater from config. Called at startup or config save."""
        # Register any initially configured repeaters
        with self._lock:
            with db.connection_context():
                for r in self.cfg.repeaters:
                    if r.pubkey not in self._repeaters:
                        self._repeaters[r.pubkey] = RepeaterState.get_or_none(
                            RepeaterState.pubkey == r.pubkey
                        )
                        if self._repeaters[r.pubkey] is None:
                            self._repeaters[r.pubkey] = RepeaterState(
                                name=r.name, pubkey=r.pubkey
                            )
                            self._repeaters[r.pubkey].save(force_insert=True)
                    else:
                        # Update name if it changed in settings
                        self._repeaters[r.pubkey].name = r.name
                        if self._db_path:
                            self._repeaters[r.pubkey].save()

    def remove_repeater(self, pubkey: str):
        """Remove a repeater from the live store (when deleted from settings)."""
        with self._lock:
            deleted = self._repeaters.pop(pubkey, None)
            if deleted is not None:
                with db.connection_context():
                    deleted.save()

    def sync_repeaters(self):
        """Sync store with configured repeater list. Add new, remove stale."""
        with self._lock:
            configured_keys = {r.pubkey for r in self.cfg.repeaters}
            # Remove repeaters no longer in config
            for pk in list(self._repeaters.keys()):
                if pk not in configured_keys:
                    with db.connection_context():
                        self._repeaters[pk].save()
                    del self._repeaters[pk]
        # Add/update configured ones
        self.init_repeaters()

    def reorder(self, pubkeys: list):
        """Reorder the in-memory repeaters dict to match the given pubkey order."""
        with self._lock:
            ordered = OrderedDict(
                {pk: self._repeaters[pk] for pk in pubkeys if pk in self._repeaters}
            )
            for pk, v in self._repeaters.items():
                if pk not in ordered:
                    ordered[pk] = v
            self._repeaters = ordered

    def update_route(self, pubkey: str, hops: int, route_path: str):
        """Update hop count and route path without touching last_seen."""
        with self._lock:
            if pubkey in self._repeaters:
                self._repeaters[pubkey].hops = hops
                self._repeaters[pubkey].route_path = route_path
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def get_route_by_prefix(self, pubkey_prefix: str) -> tuple:
        """Return (hops, route_path) for the first repeater whose pubkey starts with the given prefix.
        Returns (-1, '') if not found."""
        if not pubkey_prefix:
            return (-1, "")
        pre = pubkey_prefix.lower()
        with self._lock:
            for pk, state in self._repeaters.items():
                if pk.lower().startswith(pre) or pre.startswith(pk.lower()):
                    if state.route_path or state.hops >= 0:
                        return (state.hops, state.route_path)
        return (-1, "")

    def update_location(self, pubkey: str, lat: float, lon: float):
        """Update GPS coordinates without touching last_seen."""
        with self._lock:
            if pubkey in self._repeaters:
                self._repeaters[pubkey].lat = lat
                self._repeaters[pubkey].lon = lon
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def mark_poll_failed(self, pubkey: str):
        """Mark the last poll as failed (login, status, or telemetry request attempts timed out)."""
        with self._lock:
            if pubkey in self._repeaters:
                self._repeaters[pubkey].last_poll_ok = False
                self._repeaters[pubkey].last_poll_timestamp = time.time()
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def update_repeater(self, pubkey: str, **kwargs):
        """Update a repeater's state with new data from a poll response."""
        ts = time.time()
        with self._lock:
            metrics_to_store = RepeaterState.get_metric_labels_dict().keys()
            try:
                with db.connection_context():

                    if pubkey not in self._repeaters:
                        self._repeaters[pubkey] = RepeaterState(pubkey=pubkey)
                    r = self._repeaters[pubkey]
                    for k, v in kwargs.items():
                        if hasattr(r, k) and v is not None:
                            setattr(r, k, v)
                            if (
                                self._db_path
                                and k in metrics_to_store
                                and isinstance(v, numbers.Number)
                            ):
                                Measurement.create(
                                    timestamp=ts,
                                    pubkey=pubkey,
                                    measurement_code=k,
                                    measurement_value=float(v),
                                )

                    r.last_seen_epoch = ts
                    r.last_poll_ok = True
                    r.last_poll_timestamp = ts

                    if self._db_path:
                        r.save()
            except Exception as e:
                print(f"[DataStore] DB write error: {e}")

    def get_all(self) -> List[dict]:
        """Return all repeater states as a JSON-serializable list. This will use the configured default lat/long if the
        repeater has not returned it's own value.
        """
        with self._lock:
            result = []
            for pubkey, r in self._repeaters.items():
                data = r.to_dict()
                repeater_cfg = self.cfg.get_repeater(pubkey)
                if repeater_cfg:
                    if not data["lat"] or not data["lon"]:
                        data["lat"] = data["lat"] or repeater_cfg.lat
                        data["lon"] = data["lon"] or repeater_cfg.lon
                    data["paused"] = repeater_cfg.paused
                    data["clock_offset_limit"] = self.cfg.clock_offset_limit
                result.append(data)
            return result

    def get(self, pubkey):
        repeater = None
        with self._lock:
            for r in self._repeaters.values():
                if (
                    r.pubkey == pubkey
                    or pubkey.startswith(r.pubkey)
                    or r.pubkey.startswith(pubkey)
                ):
                    repeater = r.to_dict()
                    break
        return repeater

    def get_history(
        self, pubkey: str, months: int = 0, days: int = 0, hours: int = 0
    ) -> List[dict]:
        """Return historical telemetry for a repeater over the last N hours."""
        if not self._db_path:
            return []
        since = (
            datetime.now()
            - relativedelta(months=months)
            - timedelta(days=days, hours=hours)
        ).timestamp()
        try:
            with db.connection_context():
                query = (
                    Measurement.select()
                    .where(
                        (Measurement.pubkey == pubkey) & (Measurement.timestamp > since)
                    )
                    .order_by(Measurement.timestamp)
                )
                # Now reformat to what the charter expects, and smooth into 1 minute blocks
                output_format = {}
                data_keys = set()
                for meas in query:
                    if (
                        meas.measurement_code
                        in RepeaterState.get_metric_labels_dict().keys()
                    ):
                        data_keys.add(meas.measurement_code)
                        output_format.setdefault(
                            round(meas.timestamp / (60 * 5)) * 60 * 5, {}
                        ).setdefault(meas.measurement_code, []).append(
                            meas.measurement_value
                        )
                items = {
                    k: v
                    for k, v in RepeaterState.get_metric_labels_dict().items()
                    if k in data_keys
                }
                return {
                    "items": items,
                    "defaults": RepeaterState.get_default_metric_fields(),
                    "data": [
                        {
                            "timestamp": k,
                            **{ki: sum(vi) / len(vi) for ki, vi in v.items()},
                        }
                        for k, v in sorted(output_format.items())
                    ],
                }
        except Exception as e:
            print(f"[DataStore] DB read error: {e}")
            return {"items": {}, "data": []}

    def get_log_handler(self) -> logging.Handler:
        """Return a logging handler that writes to the activity_log table."""
        if not self._db_path:
            return logging.NullHandler()
        handler = SQLiteLogHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        return handler

    def get_activity_logs(
        self, hours: int = 24, level: str = None, search: str = None, limit: int = 500
    ) -> list:
        """Return recent activity log entries, optionally filtered by level and message text."""
        if not self._db_path:
            return []
        since = time.time() - (hours * 3600)
        try:
            with db.connection_context():
                query = ActivityLog.select().where(ActivityLog.timestamp > since)
                if level:
                    query = query.where(ActivityLog.level == level.upper())
                if search:
                    query = query.where(ActivityLog.message.contains(search))
                query = query.order_by(ActivityLog.timestamp.desc()).limit(limit)

                return list(query.dicts())
        except Exception as e:
            print(f"[DataStore] Activity log read error: {e}")
            return []

    def store_message(
        self,
        direction: str,
        channel_idx,
        sender_pubkey: str,
        sender_name: str,
        text: str,
        hops: int = -1,
        path: str = "",
        ack_code: str = "",
    ) -> bool:
        """Store an incoming or outgoing message, skipping duplicates.
        Returns True if the message was new, False if it was a duplicate."""
        if not self._db_path:
            return True  # no DB — treat as new so callers still act on it
        try:
            since = time.time() - 300  # dedup window: 5 minutes
            with db.connection_context():
                existing = (
                    Message.select(Message.id)
                    .where(
                        (Message.direction == direction)
                        & (
                            (Message.channel_idx == channel_idx)
                            | (Message.channel_idx.is_null() & (channel_idx is None))
                        )
                        & (Message.sender_pubkey == (sender_pubkey or ""))
                        & (Message.text == text)
                        & (Message.timestamp > since)
                    )
                    .first()
                )
                if existing:
                    return False  # duplicate — skip

                Message.create(
                    timestamp=time.time(),
                    direction=direction,
                    channel_idx=channel_idx,
                    sender_pubkey=sender_pubkey or "",
                    sender_name=sender_name or "",
                    text=text,
                    hops=hops,
                    path=path or "",
                    ack_code=ack_code or "",
                )
                self.has_new_message = True
                return True  # new message
        except Exception as e:
            print(f"[DataStore] Message store error: {e}")
            return True  # on error, assume new so we don't silently drop notifications

    def increment_message_acks(self, ack_code: str) -> int:
        """Increment ack count for the outgoing message matching ack_code.
        Returns the new total ack count, or 0 if not found."""
        if not self._db_path or not ack_code:
            return 0
        try:
            with db.connection_context():
                query = Message.update(acks=Message.acks + 1).where(
                    (Message.ack_code == ack_code) & (Message.direction == "out")
                )
                query.execute()

                msg = (
                    Message.select(Message.acks)
                    .where(
                        (Message.ack_code == ack_code) & (Message.direction == "out")
                    )
                    .first()
                )
                return msg.acks if msg else 0
        except Exception as e:
            print(f"[DataStore] ACK update error: {e}")
            return 0

    def get_messages(self, channel_idx=None, hours: int = 48, limit: int = 200) -> list:
        """Return recent messages, optionally filtered by channel."""
        if not self._db_path:
            return []
        since = time.time() - (hours * 3600)
        try:
            with db.connection_context():
                query = Message.select().where(Message.timestamp > since)
                if channel_idx is not None:
                    query = query.where(Message.channel_idx == channel_idx)
                query = query.order_by(Message.timestamp.desc()).limit(limit)

                return list(query.dicts())
        except Exception as e:
            print(f"[DataStore] Message read error: {e}")
            return []

    def upsert_advert_node(
        self, pubkey: str, name: str, lat: float = None, lon: float = None
    ):
        """Upsert a node discovered via advert packet."""
        if not self._db_path or not pubkey or not name:
            return
        try:
            with db.connection_context():
                AdvertNode.insert(
                    pubkey=pubkey, name=name, lat=lat, lon=lon, last_seen=time.time()
                ).on_conflict(
                    conflict_target=[AdvertNode.pubkey],
                    preserve=[AdvertNode.name, AdvertNode.last_seen],
                    update={
                        "lat": peewee.fn.COALESCE(peewee.EXCLUDED.lat, AdvertNode.lat),
                        "lon": peewee.fn.COALESCE(peewee.EXCLUDED.lon, AdvertNode.lon),
                    },
                ).execute()
        except Exception as e:
            print(f"[DataStore] Advert node upsert error: {e}")

    def get_advert_nodes(self) -> list:
        """Return all advert-discovered nodes."""
        if not self._db_path:
            return []
        try:
            with db.connection_context():
                return list(
                    AdvertNode.select().order_by(AdvertNode.last_seen.desc()).dicts()
                )
        except Exception as e:
            print(f"[DataStore] Advert nodes read error: {e}")
            return []

    def load_node_names(self) -> dict:
        """Load persisted node ID → name cache from DB."""
        if not self._db_path:
            return {}
        try:
            with db.connection_context():
                query = NodeName.select()
                return {row.node_id: row.name for row in query}
        except Exception as e:
            print(f"[DataStore] Node names load error: {e}")
            return {}

    def save_node_names(self, cache: dict):
        """Persist node ID → name cache to DB (upsert all entries)."""
        if not self._db_path or not cache:
            return
        try:
            now = time.time()
            with db.connection_context():
                data = [
                    {"node_id": k, "name": v, "updated": now} for k, v in cache.items()
                ]
                NodeName.insert_many(data).on_conflict_replace().execute()
        except Exception as e:
            print(f"[DataStore] Node names save error: {e}")

    def prune_activity_logs(self, retention_hours: int):
        """Delete activity log entries older than retention_hours."""
        if not self._db_path:
            return
        cutoff = time.time() - (retention_hours * 3600)
        try:
            with db.connection_context():
                ActivityLog.delete().where(ActivityLog.timestamp < cutoff).execute()
        except Exception as e:
            print(f"[DataStore] Activity log prune error: {e}")

    def update_repeater_clock(self, pubkey, timestamp):
        try:
            time_offset_seconds = round(timestamp - time.time())
            with self._lock:
                if pubkey in self._repeaters:
                    self._repeaters[pubkey].time = timestamp
                    self._repeaters[pubkey].time_offset_seconds = time_offset_seconds
                    if self._db_path:
                        with db.connection_context():
                            self._repeaters[pubkey].save()
        except Exception as e:
            print(f"[DataStore] Repeater time update error: {e}")

    def save_neighbours(self, pubkey, neighbour_data):
        # The neighbours data consists of a dict of:
        # pubkey (short)
        # secs_ago
        # snr
        ts_start = time.time()
        with self._lock:
            for neighbour in neighbour_data:
                pubkey_remote = neighbour["pubkey"]
                # These should be from adverts so grouping by 10s blocks should be more than accurate enough
                # but suppress jitter from timings.
                timestamp = round((ts_start - neighbour["secs_ago"]) / 10) * 10
                snr = neighbour["snr"]
                try:
                    snr = float(snr)
                    if snr is not None:
                        with db.connection_context():
                            Neighbour.insert(
                                timestamp=timestamp,
                                pubkey=pubkey,
                                pubkey_remote=pubkey_remote,
                                snr=snr,
                            ).on_conflict_ignore().execute()
                except Exception as e:
                    print(f"[DataStore] Neighbour upsert error: {e}")

            if pubkey in self._repeaters:
                self._repeaters[pubkey].last_neighbour_poll = ts_start
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def get_most_recent_neighbours(self):
        try:
            with db.connection_context():
                subquery = Neighbour.select(
                    Neighbour.pubkey,
                    Neighbour.pubkey_remote,
                    Neighbour.timestamp,
                    Neighbour.snr,
                    fn.ROW_NUMBER()
                    .over(
                        partition_by=[Neighbour.pubkey, Neighbour.pubkey_remote],
                        order_by=[Neighbour.timestamp.desc()],
                    )
                    .alias("row_rank"),
                ).alias("top_n_subq")
                query = (
                    Neighbour.select(
                        subquery.c.pubkey,
                        subquery.c.pubkey_remote,
                        subquery.c.timestamp,
                        subquery.c.snr,
                    )
                    .from_(subquery)
                    .where(subquery.c.row_rank == 1)
                )
                return list(query.dicts())
        except Exception as e:
            print(f"[DataStore] Neighbour retrieve error: {e}")

    def save_version_info(self, pubkey, version_info):
        with self._lock:
            if pubkey in self._repeaters:
                self._repeaters[pubkey].fw_version = version_info
                self._repeaters[pubkey].last_fw_poll = time.time()
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def update_last_logged_in(self, pubkey, login_ts=None):
        if login_ts is None:
            login_ts = time.time()

        with self._lock:
            if pubkey in self._repeaters:
                self._repeaters[pubkey].last_login_timestamp = login_ts
                if self._db_path:
                    with db.connection_context():
                        self._repeaters[pubkey].save()

    def save_repeater_command_message(self, pubkey, is_command, text):
        # Save a repeater command message or reply to cli command
        ts = time.time()
        with self._lock:
            try:
                with db.connection_context():
                    RepeaterCommandMessage.create(
                        timestamp=ts, pubkey=pubkey, is_command=is_command, text=text
                    )
            except Exception as e:
                print(f"[DataStore] Error saving repeater cli cmd: {e}")

    def get_command_history(self, pubkey, limit=200):
        with self._lock:
            try:
                with db.connection_context():
                    query = (
                        RepeaterCommandMessage.select()
                        .order_by(RepeaterCommandMessage.id.desc())
                        .where(RepeaterCommandMessage.pubkey == pubkey)
                        .limit(limit)
                    )
                    result = list(query.dicts())
                    result.reverse()
                    return result
            except Exception as e:
                print(f"[DataStore] Error saving repeater cli cmd: {e}")
