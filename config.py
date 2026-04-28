# ============================================================
# MeshCore Repeater Dashboard - Configuration
# ============================================================
# Settings can be edited here OR from the web dashboard's
# Settings page. Web-based changes are saved to settings.json
# and override values in this file.
# ============================================================

import json
import numbers
from pathlib import Path

_SETTINGS_FILE = Path(__file__).parent / "settings.json"


class Config:
    # Constants:
    # --- History (not editable from web UI) ---
    enable_history = True
    history_db = "repeater_history.db"

    class CompanionType:
        SERIAL_USB = 1
        TCP = 2

    # --- Configurable + their defaults (used if settings.json doesn't exist yet) ---

    configurables = {
        "companion_type": CompanionType.TCP,
        "companion_host": "localhost",
        "companion_port": 5000,
        "repeaters": [
            # {"name": "Repeater 1", "pubkey": "PASTE_PUBKEY_HERE"},
        ],
        "poll_interval_seconds": 3600,
        "stagger_delay_seconds": 30,
        "stale_threshold_seconds": 900,
        "low_battery_percent": 20,
        "log_retention_hours": 24,
        "map_path_max_km": 300,
        "node_id_chars": 2,
        "channels": [
            {"name": "Primary", "idx": 0},
        ],
        "ntfy_topic": "",
        "ntfy_server": "https://ntfy.sh",
        "ntfy_enabled": True,
        "dashboard_url": "",
    }

    def __init__(self):
        self._load()

    def _load(self) -> dict:

        def convert_or_default(dict, key, default_val):
            if key not in dict:
                return default_val
            
            try:
                if isinstance(default_val, numbers.Number):
                    return type(default_val)(dict[key])
                return dict[key]
            except ValueError:
                return default_val
            
        """Load settings from settings.json, falling back to defaults."""
        try:
            with open(_SETTINGS_FILE, "r") as f:
                settings = json.load(f)
        except (json.JSONDecodeError, IOError, FileNotFoundError) as e:
            print(f"[config] Error reading {_SETTINGS_FILE}: {e}, using defaults")
            settings = {}
        # Merge with defaults so new keys are always present
        for key, val in self.configurables.items():
            setattr(self, key, convert_or_default(settings, key, val))


    def save(self):
        """Save settings to settings.json."""
        settings = dict()
        for key, default_val in self.configurables.items():
            settings[key] = getattr(self, key, default_val)

        with open(_SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)

    def as_dict(self):
        return {key: getattr(self, key, default_val) for key, default_val in self.configurables.items()}
