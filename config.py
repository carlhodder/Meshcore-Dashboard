# ============================================================
# MeshCore Repeater Dashboard - Configuration
# ============================================================
# Settings can be edited here OR from the web dashboard's
# Settings page. Web-based changes are saved to settings.json
# and override values in this file.
# ============================================================

import json
from pathlib import Path
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, ValidationError

_SETTINGS_FILE = Path(__file__).parent / "settings.json"


from typing import List, Dict, Any


class UserConfigurables(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    class CompanionType:
        SERIAL_USB = 1
        TCP = 2

    companion_type: int = CompanionType.TCP
    companion_host: str = "localhost"
    companion_port: int = 5000
    repeaters: List[Dict[str, Any]] = []
    poll_interval_seconds: int = 3600
    stagger_delay_seconds: int = 30
    stale_threshold_seconds: int = 900
    low_battery_percent: int = 20
    log_retention_hours: int = 24
    map_path_max_km: int = 300
    node_id_chars: int = 2
    channels: List[Dict[str, Any]] = [{"name": "Primary", "idx": 0}]
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    ntfy_enabled: bool = True
    dashboard_url: str = ""


class Config(UserConfigurables):
    # Constants:
    # --- History (not editable from web UI) ---
    enable_history: ClassVar[bool] = True
    history_db: ClassVar[str] = "repeater_history.db"

    def _load(self) -> dict:
        """Load settings from settings.json, falling back to defaults."""
        try:
            with open(_SETTINGS_FILE, "r") as f:
                settings = json.load(f)
        except (json.JSONDecodeError, IOError, FileNotFoundError) as e:
            print(f"[config] Error reading {_SETTINGS_FILE}: {e}, using defaults")
            settings = {}

        # Merge data with defaults so keys always exist w/ valid value.
        try:
            current_data = self.model_dump()
            self = Config.model_validate({**current_data, **settings})
        except ValidationError as e:
            print(f"[config] Using defaults due to errors loading values: {e.errors()}")

    def save(self):
        """Save settings to settings.json."""
        with open(_SETTINGS_FILE, "w") as f:
            json.dump(
                UserConfigurables(**self.model_dump()).model_dump(mode="json"),
                f,
                indent=2,
            )

    def as_dict(self):
        return UserConfigurables(**self.model_dump()).model_dump(mode="json")
