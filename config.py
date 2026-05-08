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

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

_SETTINGS_FILE = Path(__file__).parent / "data/settings.json"


from typing import List, Dict, Any

class RepeaterConfig(BaseModel):
    name: str
    pubkey: str
    path: str = ""
    admin_pass: str = ""
    lat: float | None = None
    lon: float | None = None


class UserConfigurables(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    class CompanionType:
        SERIAL_USB = 1
        TCP = 2

    polling_enabled: bool = True
    companion_type: int = CompanionType.TCP
    companion_host: str = ""
    companion_port: int = 5000
    repeaters: List[RepeaterConfig] = []
    poll_interval_hours: int = 6
    stagger_delay_seconds: int = 30
    low_battery_percent: int = 20
    log_retention_hours: int = 24
    map_path_max_km: int = 300
    node_id_chars: int = 2
    channels: List[Dict[str, Any]] = [{"name": "Primary", "idx": 0}]
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    ntfy_enabled: bool = True
    dashboard_url: str = ""
    home_lat: float = 0.0
    home_lon: float = 0.0
    neighbours_enabled: bool = True
    neighbours_check_hours: int = 12
    clock_check_enabled: bool = True
    clock_check_days: int = 7
    firmware_get_enabled: bool = False
    firmware_get_days: int = 7

    @field_validator("companion_type", mode="after")
    @classmethod
    def companion_type_is_valid(cls, value) -> CompanionType:
        if value not in [cls.CompanionType.SERIAL_USB, cls.CompanionType.TCP]:
            raise ValueError("Invalid companion_type")
        return value

    @field_validator("poll_interval_hours", mode="after")
    @classmethod
    def poll_interval_hours_is_valid(cls, value) -> int:
        if value < 1:
            raise ValueError("Poll interval must be >= 1 hr")
        return value

    @field_validator("stagger_delay_seconds", mode="after")
    @classmethod
    def stagger_delay_seconds_is_valid(cls, value) -> int:
        if value < 5:
            raise ValueError("Stagger delay must be >= 5s")
        return value

    @field_validator("log_retention_hours", mode="after")
    @classmethod
    def log_retention_hours_is_valid(cls, value) -> int:
        if value < 1:
            raise ValueError("Log retention must be >= 1")
        return value

    @field_validator("map_path_max_km", mode="after")
    @classmethod
    def map_path_max_km_is_valid(cls, value) -> int:
        if value < 10:
            raise ValueError("Map path max km must be >= 10")
        return value

    @field_validator("node_id_chars", mode="after")
    @classmethod
    def node_id_chars_is_valid(cls, value) -> int:
        if value not in [2, 4, 6]:
            raise ValueError("Node id chars must be 2, 4, or 6")
        return value

    @field_validator("neighbours_check_hours", mode="after")
    @classmethod
    def neighbours_check_hours_is_valid(cls, value) -> int:
        if value < 1:
            raise ValueError("neighbours_check_hours must be >= 1 (1 hr)")
        return value

    @field_validator("clock_check_days", mode="after")
    @classmethod
    def clock_check_days_is_valid(cls, value) -> int:
        if value < 1:
            raise ValueError("clock_check_days must be >= 1 (1 day)")
        return value

    @field_validator("firmware_get_days", mode="after")
    @classmethod
    def firmware_get_days_is_valid(cls, value) -> int:
        if value < 1:
            raise ValueError("firmware_get_days must be >= 1 (1 day)")
        return value


class Config(UserConfigurables):
    # Constants:
    # --- History (not editable from web UI) ---
    enable_history: ClassVar[bool] = True
    history_db: ClassVar[str] = "data/repeater_history.db"

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
            loaded = Config.model_validate({**current_data, **settings})
            for k, v in loaded.as_dict().items():
                setattr(self, k, v)

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

    def validate_and_save(self, new_data):
        current_data = self.model_dump()
        new = Config.model_validate({**current_data, **new_data})
        for k, v in new.as_dict().items():
            setattr(self, k, v)
        self.save()

    def as_dict(self):
        return UserConfigurables(**self.model_dump()).model_dump(mode="json")

    def get_repeater(self, pubkey):
        if not pubkey:
            return None

        for r in self.repeaters:
            if r.pubkey == pubkey or r.pubkey.startswith(pubkey):
                return r
        return None
