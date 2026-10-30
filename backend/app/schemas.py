from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Channel(str, Enum):
    sms = "sms"
    missed_call = "missed_call"


class IncidentStatus(str, Enum):
    reported = "reported"
    assigned = "assigned"
    repairing = "repairing"
    restored = "restored"


class SimulationInput(BaseModel):
    load_pct: float = Field(ge=0, le=180)
    oil_temp_c: float = Field(ge=-10, le=150)
    ambient_temp_c: float = Field(ge=-20, le=65)
    rainfall_mm: float = Field(ge=0, le=500)

    @model_validator(mode="after")
    def validate_temperature_relationship(self) -> "SimulationInput":
        if self.oil_temp_c < self.ambient_temp_c - 10:
            raise ValueError("oil_temp_c is implausibly below ambient_temp_c")
        return self


class OutageReportCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    village_name: str = Field(min_length=2, max_length=100)
    transformer_id: str | None = Field(default=None, pattern=r"^T-\d{3}$")
    channel: Channel
    message: str | None = Field(default=None, max_length=500)
    received_at: datetime | None = None
    caller_id: str | None = Field(default=None, min_length=2, max_length=100)
    feeder_id: str | None = Field(default=None, pattern=r"^F-\d{2}$")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("received_at")
    @classmethod
    def normalize_received_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("received_at must include a timezone")
        now = datetime.now(timezone.utc)
        if value.astimezone(timezone.utc) > now.replace(microsecond=0):
            raise ValueError("received_at cannot be in the future")
        return value.astimezone(timezone.utc)


class IncidentUpdate(BaseModel):
    status: IncidentStatus
    eta_note: str | None = Field(default=None, max_length=200)
    assigned_crew: str | None = Field(default=None, max_length=100)
    restoration_notes: str | None = Field(default=None, max_length=1000)


class MaintenanceUpdate(BaseModel):
    status: str = Field(pattern=r"^(recommended|scheduled|in_progress|completed|dismissed)$")


class RichSimulationOverrides(BaseModel):
    load_utilization_pct: float = Field(ge=0, le=180)
    oil_temperature_c: float = Field(ge=-10, le=150)
    ambient_temperature_c: float = Field(ge=-20, le=65)
    rainfall_mm: float | None = Field(default=None, ge=0, le=500)

    @model_validator(mode="after")
    def validate_temperature_relationship(self) -> "RichSimulationOverrides":
        if self.oil_temperature_c < self.ambient_temperature_c - 10:
            raise ValueError("oil_temperature_c is implausibly below ambient_temperature_c")
        return self


class RiskSimulationRequest(BaseModel):
    transformer_id: str = Field(pattern=r"^T-\d{3}$")
    overrides: RichSimulationOverrides


class AlertUpdate(BaseModel):
    status: str = Field(pattern=r"^(open|acknowledged|resolved)$")
    acknowledged_by: str | None = Field(default=None, max_length=100)


class WorkOrderCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    transformer_id: str = Field(pattern=r"^T-\d{3}$")
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=3, max_length=1000)
    priority: str = Field(pattern=r"^(routine|medium|high|urgent)$")
    assigned_to: str | None = Field(default=None, max_length=100)
    scheduled_for: datetime | None = None


class WorkOrderUpdate(BaseModel):
    status: str = Field(pattern=r"^(open|scheduled|in_progress|completed|cancelled)$")
    assigned_to: str | None = Field(default=None, max_length=100)
    scheduled_for: datetime | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=100)


class ComplaintCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    village_name: str = Field(min_length=2, max_length=100)
    transformer_id: str | None = Field(default=None, pattern=r"^T-\d{3}$")
    category: str = Field(
        pattern=r"^(power_outage|low_voltage|flickering|transformer_noise|sparking_fire|fallen_wires|other)$"
    )
    severity: str = Field(pattern=r"^(low|medium|high|emergency)$")
    landmark: str | None = Field(default=None, max_length=200)
    duration_minutes: int | None = Field(default=None, ge=0, le=10080)
    affected_area: str | None = Field(default=None, max_length=200)
    hazard_flags: list[str] = Field(default_factory=list, max_length=10)
    language: str = Field(default="en", pattern=r"^(en|hi|pa)$")
    details: str | None = Field(default=None, max_length=1000)
    caller_id: str | None = Field(default=None, max_length=100)


class WorkOrderTransitionRequest(BaseModel):
    status: str = Field(
        pattern=r"^(accepted|en_route|arrived|investigating|repairing|awaiting_verification|rework_required|resolved|closed)$"
    )
    notes: str | None = Field(default=None, max_length=1000)
    hazards: list[str] | None = Field(default=None, max_length=20)
    safety_acknowledged: bool = False
    stop_work: bool = False


class InspectionCreate(BaseModel):
    recommendation_id: int | None = None
    status: str = Field(pattern=r"^(pending|investigated|suspected|ruled_out|confirmed)$")
    fault_category: str | None = Field(default=None, max_length=100)
    observations: str = Field(min_length=3, max_length=2000)
    suspected_root_cause: str | None = Field(default=None, max_length=1000)


class RepairReportCreate(BaseModel):
    fault_cause: str = Field(min_length=3, max_length=200)
    repair_notes: str = Field(min_length=3, max_length=3000)
    materials_used: str | None = Field(default=None, max_length=1000)
    restoration_observations: str | None = Field(default=None, max_length=2000)
    remaining_issues: str | None = Field(default=None, max_length=2000)


class SupervisorDecisionCreate(BaseModel):
    decision: str = Field(pattern=r"^(approved|rejected|rework|more_information)$")
    notes: str | None = Field(default=None, max_length=2000)


class DispatchRequest(BaseModel):
    lineman_user_id: int | None = None
    priority: str = Field(default="high", pattern=r"^(low|medium|high|emergency)$")


class ScenarioSaveRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    transformer_id: str = Field(pattern=r"^T-\d{3}$")
    inputs: dict
    result: dict

