import { useState, useEffect, useRef } from "preact/hooks";
import styles from "./Messages.module.css";

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  const time =
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0");
  if (isSameDay) return time;
  return d.getMonth() + 1 + "/" + d.getDate() + " " + time;
}

export default function Messages() {
  const [channels, setChannels] = useState([{ name: "Primary", idx: 0 }]);
  const [activeChannel, setActiveChannel] = useState(null); // null = "All"
  const [replyContact, setReplyContact] = useState(null); // { pubkey, name }
  const [hours, setHours] = useState("48");
  const [searchTerm, setSearchTerm] = useState("");
  const [messages, setMessages] = useState([]);

  const [nodeNames, setNodeNames] = useState({});
  const [contactRoutes, setContactRoutes] = useState({});
  const [cachedRoutes, setCachedRoutes] = useState({});
  const [nodeIdChars, setNodeIdChars] = useState(2);

  const [inputText, setInputText] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: "", type: "" });

  const listRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.node_id_chars) setNodeIdChars(s.node_id_chars);
      })
      .catch(() => {});

    fetch("/api/channels")
      .then((r) => r.json())
      .then((chs) => {
        const parsed =
          Array.isArray(chs) && chs.length > 0
            ? chs
            : [{ name: "Primary", idx: 0 }];
        setChannels(parsed);
        setActiveChannel(parsed[0]);
      })
      .catch(() => {});
  }, []);

  const loadRoutes = () => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((data) => {
        const cr = {};
        (data.contacts || []).concat(data.repeaters || []).forEach((c) => {
          if (!c.pubkey) return;
          const pk = c.pubkey.toLowerCase();
          cr[pk] = c;
          if (pk.length >= 4) cr[pk.substring(0, 4)] = c;
          if (pk.length >= 2) cr[pk.substring(0, 2)] = c;
        });
        setContactRoutes(cr);
      })
      .catch(() => {});

    fetch("/api/node-names")
      .then((r) => r.json())
      .then(setNodeNames)
      .catch(() => {});
    fetch("/api/contact-routes")
      .then((r) => r.json())
      .then(setCachedRoutes)
      .catch(() => {});
  };

  const loadMessages = () => {
    let url = `/api/messages?hours=${hours}&limit=500`;
    if (activeChannel !== null) {
      url += `&channel_idx=${activeChannel.idx}`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((msgs) => {
        setMessages(msgs || []);
        if (msgs && msgs.length > 0) {
          const latest = msgs[0].timestamp;
          const stored = parseFloat(
            localStorage.getItem("meshcore_last_msg_seen") || "0",
          );
          if (latest > stored) {
            localStorage.setItem("meshcore_last_msg_seen", latest.toString());
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadRoutes();
    loadMessages();
    const interval = setInterval(() => {
      loadMessages();
      loadRoutes();
    }, 5000);
    return () => clearInterval(interval);
  }, [hours, activeChannel]);

  useEffect(() => {
    if (listRef.current && messages.length > prevMsgCountRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  const lookupContact = (pubkeyPrefix) => {
    if (!pubkeyPrefix) return null;
    const p = pubkeyPrefix.toLowerCase();
    return (
      contactRoutes[p] ||
      contactRoutes[p.substring(0, 4)] ||
      contactRoutes[p.substring(0, 2)] ||
      null
    );
  };

  const handleReplyClick = (pubkey, name, chIdx) => {
    if (!pubkey) {
      if (chIdx !== null && chIdx !== undefined) {
        const ch = channels.find((c) => c.idx === chIdx);
        if (ch) setActiveChannel(ch);
      }
      setReplyContact(null);
      setInputText(`{${name}:} `);
    } else {
      if (replyContact && replyContact.pubkey === pubkey) {
        setReplyContact(null);
        if (inputText === `{${name}:} `) setInputText("");
      } else {
        setReplyContact({ pubkey, name });
        setInputText(`{${name}:} `);
      }
    }
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || (!replyContact && !activeChannel)) return;
    setSendLoading(true);
    setStatusMsg({ text: "", type: "" });

    const body = replyContact
      ? { pubkey: replyContact.pubkey, text }
      : { channel_idx: activeChannel.idx, text };

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setInputText("");
        if (replyContact) {
          setReplyContact(null);
        }
        loadMessages();
      } else {
        setStatusMsg({
          text: `\u2717 Failed: ${data.error || "unknown"}`,
          type: styles.err,
        });
      }
    } catch (e) {
      setStatusMsg({
        text: `\u2717 Not sent \u2014 ${e.message}`,
        type: styles.err,
      });
    }
    setSendLoading(false);
  };

  const filteredMsgs = messages.filter((m) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const hay = [m.text, m.sender_name, m.sender_pubkey]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  });

  const orderedMsgs = [...filteredMsgs].reverse();

  return (
    <div className={styles.msgPageBody}>
      <div className={styles.chTabs}>
        <button
          className={`${styles.chTab} ${activeChannel === null && !replyContact ? styles.active : ""}`}
          onClick={() => {
            setActiveChannel(null);
            setReplyContact(null);
          }}
        >
          All
        </button>
        {channels.map((ch) => (
          <button
            key={ch.idx}
            className={`${styles.chTab} ${activeChannel && activeChannel.idx === ch.idx && !replyContact ? styles.active : ""}`}
            onClick={() => {
              setActiveChannel(ch);
              setReplyContact(null);
            }}
          >
            {ch.name} (#{ch.idx})
          </button>
        ))}
      </div>

      <div className={styles.msgFilterBar}>
        <span className={styles.msgFilterLabel}>Show last</span>
        <select
          className={styles.msgHoursSelect}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        >
          <option value="1">1 hour</option>
          <option value="6">6 hours</option>
          <option value="12">12 hours</option>
          <option value="24">24 hours</option>
          <option value="48">48 hours</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
        </select>
        <input
          className={styles.msgSearch}
          type="search"
          placeholder="Search messages…"
          value={searchTerm}
          onInput={(e) => setSearchTerm(e.target.value)}
        />
        <span className={styles.msgFilterCount}>
          {searchTerm
            ? `${filteredMsgs.length} of ${messages.length}`
            : `${messages.length} message${messages.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      <div className={styles.msgList} ref={listRef}>
        {orderedMsgs.length === 0 ? (
          <div className={styles.msgEmpty}>No messages yet</div>
        ) : (
          orderedMsgs.map((m, idx) => {
            const isOut = m.direction === "out";
            let displayName =
              m.sender_name ||
              (m.sender_pubkey
                ? m.sender_pubkey.substring(0, nodeIdChars)
                : "Unknown");
            if (!isOut && !m.sender_pubkey) {
              const match = m.text.match(/^([^:\n]{1,60}):\s+/);
              if (match) displayName = match[1].trim();
            }

            let hops = m.hops !== undefined && m.hops >= 0 ? m.hops : null;
            let routePath = m.path || "";
            if (!isOut && m.sender_pubkey && (hops === null || !routePath)) {
              const contact = lookupContact(m.sender_pubkey);
              if (contact) {
                if (hops === null) hops = contact.hops;
                if (!routePath) routePath = contact.route_path || "";
              }
            }
            if (!isOut && !routePath && m.sender_pubkey) {
              const pk = m.sender_pubkey.toUpperCase();
              const cr = cachedRoutes[pk] || cachedRoutes[pk.substring(0, 2)];
              if (cr) {
                if (hops === null) hops = cr.hops;
                routePath = cr.path || "";
              }
            }

            return (
              <div
                key={idx}
                className={`${styles.msgItem} ${isOut ? styles.outgoing : styles.incoming}`}
              >
                {!isOut ? (
                  <div className={styles.msgSender}>
                    <span className={styles.msgSenderName}>{displayName}</span>
                    {hops !== null && (
                      <span className={styles.msgHops}>
                        {hops === 0
                          ? "Direct"
                          : `${hops} hop${hops !== 1 ? "s" : ""}`}
                      </span>
                    )}
                    <button
                      className={styles.msgReplyBtn}
                      title={`Reply to ${displayName}`}
                      onClick={() =>
                        handleReplyClick(
                          m.sender_pubkey,
                          displayName,
                          m.channel_idx,
                        )
                      }
                    >
                      &#8617;
                    </button>
                  </div>
                ) : (
                  <div className={styles.msgSender}>You</div>
                )}

                <div className={styles.msgBubble}>{m.text}</div>
                <div className={styles.msgTime}>{fmtTime(m.timestamp)}</div>

                {isOut && (
                  <div
                    className={`${styles.msgAcks} ${m.acks > 0 ? "" : m.ack_code ? styles.msgAcksWaiting : styles.msgAcksZero}`}
                  >
                    {m.acks > 0 ? (
                      `\u2713 Seen by ${m.acks} node${m.acks === 1 ? "" : "s"}`
                    ) : m.ack_code ? (
                      <>
                        <span className={styles.ackPulse}></span> Waiting for
                        acknowledgement
                      </>
                    ) : (
                      `\u2713 Sent`
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.msgStatus} ${statusMsg.type}`}>
        {statusMsg.text}
      </div>

      <div className={styles.msgComposeLabel}>
        {replyContact ? (
          <>
            &#8617; Direct reply to <strong>{replyContact.name}</strong>
            <button
              className={styles.composeCancelBtn}
              onClick={() => setReplyContact(null)}
            >
              &#215; Cancel
            </button>
          </>
        ) : activeChannel ? (
          <>
            Sending to <strong>{activeChannel.name}</strong>
          </>
        ) : null}
      </div>

      <div className={styles.msgCompose}>
        <textarea
          className={`${styles.msgInput} ${replyContact ? styles.replyMode : ""}`}
          placeholder={
            replyContact
              ? `Reply to ${replyContact.name}…`
              : activeChannel
                ? "Type a message… (Shift+Enter for new line)"
                : "Select a channel to send a message…"
          }
          rows="1"
          value={inputText}
          onInput={(e) => {
            setInputText(e.target.value);
            e.target.style.height = "";
            e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
            if (e.key === "Escape" && replyContact) {
              setReplyContact(null);
            }
          }}
        ></textarea>
        <button
          className={styles.msgSendBtn}
          disabled={sendLoading || (!replyContact && !activeChannel)}
          onClick={sendMessage}
        >
          Send
        </button>
      </div>
    </div>
  );
}
