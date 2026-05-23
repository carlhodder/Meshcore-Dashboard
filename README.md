# FORK NOTES:
The original source repo is here: `https://github.com/mattwynharris/Meshcore-Dashboard`

I took the vibe coded project above and wanted to experiment, plus it's freeing knowing you can just blast fast code without issue :D

I ended up testing how well some of the models refactor code, e.g. the whole FE and a few BE bits. Ended up doing a *lot* of manual rewriting on the BE and a few bits on the FE. I'm not sure on how much further I want to take this but if there are requests I might add them.

# New Features

## Improved Metrics

Longer metric history, more metrics such as humidity and temperature, configurable plot options. 
<img width="471" height="465" alt="MonthHistory" src="https://github.com/user-attachments/assets/b5190838-29f5-43f0-b825-f9687888e07d" />

Temp and humidity metrics will disappear from tile if they're older than 3 polling cycles.
<img width="2560" height="1543" alt="Dashboard" src="https://github.com/user-attachments/assets/a160bebb-930b-4cff-b61c-3ac2a3a44644" />

## Remote Admin

Remote admin - you've already logged in for polling so why not send commands too? No one pulls the ACL's so as long as you'ved logged in since it restarted you should just be able to go ahead. 

Keeps a persistent history of commands and replies.
<img width="2560" height="1540" alt="RemoteAdmin" src="https://github.com/user-attachments/assets/049655a7-fbd8-4c30-9e88-b205fbbeb6ee" />

## FW Version and Time Offset

Second polling option for quering FW and estimating clock offset to the clock on this server (one request does both). 

Can add a clock warning that will show a new tile in the metrics with how large this is.

## Command Menu

Click the repeater hamburger menu to show extra features such as trigger advert, set clock, admin, individually pause a repeater from polling.
<img width="406" height="246" alt="Menuy" src="https://github.com/user-attachments/assets/5e79f370-8410-4bb0-88a5-ffd1b6ebebdb" />

##  Neighbours Map

<img width="2555" height="1540" alt="Neighbours" src="https://github.com/user-attachments/assets/a5256c6b-c316-43d6-a64d-c2c5e3cdef4d" />


Plot the signal strengths returned by the repeater of all it's neighbour repeaters. Click on single repeater to focus on just that one. 

(Not room servers)

## Fully working 2-byte paths

Other than determining routes which can be from 1-byte data the backend now keys on the 'pubkey_prefix' length (12 chars), so the 1/2/3 byte config setting is for display now. 

E.g. in the "Packets" page the main path pips will show what you configured, and the raw data will highlight the longer key:
<img width="2557" height="702" alt="Packet-4-byte" src="https://github.com/user-attachments/assets/f24b57cf-9370-4fb0-9ee8-14e8a6f9061d" />

## Serial/USB connection

See note below this as windows can be awkward but can now connect to a USB/tty companion instead of TCP.

Otherwise lots of little details like keeping state on restart (only packets are lost but paths are maintained), differentiating flood vs direct path from contact on send, repeating failed packets before giving up, mobile view tweaks, drag + drop ordering, individual repeater pause, added text colours at levels for noise floor + temperature, default lat/lon in repeater config if you want to plot a personal room w/o address, an "All time" option for message history, a quiet log, added missing message types to FE, tidied config value units, blah blah. 



If you have data from the old dashboard back it up, but it should migrate through to the new format so any history of those values that were saved will display. You will need to recofigure most bits though - I have not migrated those.


Better instructions to come, but basically just:
- Clone the repo
- docker compose up --build 

And it runs http://localhost:8080.

The "install.sh" script there checks if you have docker and compose and runs the above ,if you're the run random scripts on repos sort of guy.


If you want serial in linux add this to the docker-compose.yml file with the keys at the same level as "build":
```
    devices:
      - /dev/ttyACM0
    group_add:
      - dialout
```

If you're on windows there are extra steps, it's not great so I think there's a serial -> TCP thing that may be easier.


Everything below here is the original:


# MeshCore Repeater Dashboard

A self-hosted web dashboard for monitoring MeshCore LoRa repeaters and contacts via a companion WiFi node.

**Requirement:** You need a MeshCore WiFi companion node running and accessible on your network. The companion node must have TCP enabled — it listens on port **5000** by default.

## Features

- **Dashboard** — live battery, signal (RSSI/SNR), uptime, and hop count for each configured repeater; historical charts
- **Map** — plots repeaters, contacts, and advertising nodes on a live Leaflet map
  - Network path overlay showing routes through actual hops (teal = single route, amber = shared/merged segment)
  - Click a repeater to isolate and highlight only its paths; click off to restore prior state
  - 300 km sanity filter — no misleading straight lines for unknown paths
- **Messages** — channel and direct message log from the companion node
- **Packets** — raw RX log / packet feed
- **Logs** — app and poller activity log
- **Settings** — configure companion IP, repeater list (name, pubkey, admin password), poll timing, and software updates


---
<img width="1440" height="669" alt="Screenshot 2026-03-26 at 9 15 12 PM" src="https://github.com/user-attachments/assets/a0aacd82-5f93-4eec-a61f-1dbf62895e44" />
<img width="1430" height="761" alt="Screenshot 2026-03-26 at 9 15 55 PM" src="https://github.com/user-attachments/assets/5c57ad33-fe68-4ddb-b409-cd4b2faed2c9" />
<img width="1431" height="743" alt="Screenshot 2026-03-26 at 9 22 50 PM" src="https://github.com/user-attachments/assets/2b611ffe-5f00-4e1b-9a40-574e7a72d9df" />

---
## VM Requirement 
- Guest OS Ubuntu Linux (64-bit)
- Compatibility ESXi 7.0 U2 virtual machine
- VMware Tools Yes
- CPUs 2
- Memory 2 GB

---
## Installation

### 1. Set Up VM and Install Docker on your device
Set up your VM OS Ubuntu Linux 
then SSH in to your VM 

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```
> Log out and back in before continuing.

### 2. Clone the repo and run setup

```bash
git clone https://github.com/mattwynharris/Meshcore-Dashboard.git
cd Meshcore-Dashboard
bash install.sh
```

The script builds the Docker image and starts the dashboard. It prints the URL when done.

### 3. Open the dashboard and configure it

> **Requirement:** You need a MeshCore WiFi companion node running and accessible on your network. The companion node must have TCP enabled — it listens on port **5000** by default.

Go to `http://<device-ip>:8080`, click the **⚙ Settings** icon and enter:

- Companion device IP address and port *(default port: 5000)*
- Each repeater — name, public key, and admin password
- Click **Save & Apply**

The dashboard starts polling your repeaters straight away.

---

## Applying Updates

No SSH needed — updates are applied through the dashboard UI.

1. Download the latest `meshcore-dashboard-update-VX.X.zip` from the [Releases page](https://github.com/mattwynharris/Meshcore-Dashboard/releases)
2. Open **Settings** → scroll to **Software Update**
3. Click **Choose .zip…** → select the downloaded zip → click **Upload & Apply**
4. Click **Restart Now** — the page reloads automatically

---

## Useful Commands

```bash
docker compose logs -f      # live logs
docker compose restart      # restart the container
docker compose down         # stop
docker compose up -d        # start (e.g. after a reboot)
```

The container starts automatically on reboot.

---

## Data

Everything is stored in `~/meshcore-dashboard/data/` on the host — outside the container — so it survives updates and restarts:

- `data/settings.json` — companion IP, repeater list, poll timing
- `data/repeater_history.db` — telemetry history, activity logs, contact routes

---

*This project is an independent, community-built tool and is not affiliated with, endorsed by, or officially connected to MeshCore or its developers.*
