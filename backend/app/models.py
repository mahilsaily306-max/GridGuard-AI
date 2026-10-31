"""SQLAlchemy 2 declarative database model catalog.

Runtime services use small explicit SQL statements for the demo's read-heavy API,
while these models provide the typed relational contract used by Alembic and
future service expansion.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Feeder(Base):
    __tablename__ = "feeders"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    nominal_capacity_kw: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String, default="active")
    transformers: Mapped[list["Transformer"]] = relationship(back_populates="feeder")


class Village(Base):
    __tablename__ = "villages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    estimated_households: Mapped[int] = mapped_column(Integer, nullable=False)
    data_source: Mapped[str] = mapped_column(String, default="synthetic")


class Transformer(Base):
    __tablename__ = "transformers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    feeder_id: Mapped[str] = mapped_column(ForeignKey("feeders.id"), index=True)
    village_id: Mapped[int | None] = mapped_column(ForeignKey("villages.id"))
    village_name: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str | None] = mapped_column(String)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    capacity_kva: Mapped[float] = mapped_column(Float)
    age_years: Mapped[int] = mapped_column(Integer)
    installation_year: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="operational")
    feeder: Mapped[Feeder] = relationship(back_populates="transformers")


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (UniqueConstraint("transformer_id", "observed_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str] = mapped_column(ForeignKey("transformers.id"), index=True)
    observed_at: Mapped[str] = mapped_column(String, index=True)
    load_pct: Mapped[float] = mapped_column(Float)
    oil_temp_c: Mapped[float] = mapped_column(Float)
    ambient_temp_c: Mapped[float] = mapped_column(Float)
    rainfall_mm: Mapped[float] = mapped_column(Float)
    apparent_load_kva: Mapped[float | None] = mapped_column(Float)
    power_factor: Mapped[float | None] = mapped_column(Float)
    voltage_v: Mapped[float | None] = mapped_column(Float)
    current_a: Mapped[float | None] = mapped_column(Float)
    phase_imbalance_pct: Mapped[float | None] = mapped_column(Float)
    quality_flag: Mapped[str] = mapped_column(String, default="good")
    provenance: Mapped[str] = mapped_column(String, default="synthetic_sensor")


class FaultHistory(Base):
    __tablename__ = "fault_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str] = mapped_column(ForeignKey("transformers.id"), index=True)
    fault_at: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    duration_min: Mapped[int] = mapped_column(Integer)


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (CheckConstraint("risk_score BETWEEN 0 AND 1"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str] = mapped_column(ForeignKey("transformers.id"), index=True)
    generated_at: Mapped[str] = mapped_column(String)
    horizon_hours: Mapped[int] = mapped_column(Integer, default=24)
    risk_score: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String)
    model_version: Mapped[str] = mapped_column(String)
    is_simulation: Mapped[int] = mapped_column(Integer, default=0)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (UniqueConstraint("dedupe_key", "status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str | None] = mapped_column(ForeignKey("transformers.id"))
    feeder_id: Mapped[str | None] = mapped_column(ForeignKey("feeders.id"))
    category: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    explanation: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="open")
    acknowledged_by: Mapped[str | None] = mapped_column(String)
    acknowledged_at: Mapped[str | None] = mapped_column(String)
    dedupe_key: Mapped[str] = mapped_column(String)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)


class OutageReport(Base):
    __tablename__ = "outage_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str | None] = mapped_column(ForeignKey("transformers.id"))
    village_name: Mapped[str] = mapped_column(String)
    channel: Mapped[str] = mapped_column(String)
    message: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[str] = mapped_column(String)
    caller_hash: Mapped[str | None] = mapped_column(String)
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"))
    duplicate_count: Mapped[int] = mapped_column(Integer, default=1)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    report_status: Mapped[str] = mapped_column(String, default="received")


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feeder_id: Mapped[str] = mapped_column(ForeignKey("feeders.id"))
    suspected_transformer_id: Mapped[str | None] = mapped_column(ForeignKey("transformers.id"))
    scope: Mapped[str] = mapped_column(String)
    opened_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    restored_at: Mapped[str | None] = mapped_column(String)
    eta_note: Mapped[str | None] = mapped_column(String)
    report_count: Mapped[int] = mapped_column(Integer, default=1)
    assigned_crew: Mapped[str | None] = mapped_column(String)
    restoration_notes: Mapped[str | None] = mapped_column(Text)
    estimated_households: Mapped[int] = mapped_column(Integer, default=0)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.5)
    localization_explanation: Mapped[str | None] = mapped_column(Text)


class IncidentStatusHistory(Base):
    __tablename__ = "incident_status_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id"), index=True)
    status: Mapped[str] = mapped_column(String)
    changed_at: Mapped[str] = mapped_column(String)


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str] = mapped_column(ForeignKey("transformers.id"), index=True)
    performed_at: Mapped[str] = mapped_column(String)
    maintenance_type: Mapped[str] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(Text)
    provenance: Mapped[str] = mapped_column(String, default="synthetic_record")


class MaintenanceWorkOrder(Base):
    __tablename__ = "maintenance_work_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transformer_id: Mapped[str] = mapped_column(ForeignKey("transformers.id"), index=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="open")
    assigned_to: Mapped[str | None] = mapped_column(String)
    scheduled_for: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
    completed_at: Mapped[str | None] = mapped_column(String)


class WeatherObservation(Base):
    __tablename__ = "weather_observations"
    __table_args__ = (UniqueConstraint("feeder_id", "observed_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feeder_id: Mapped[str] = mapped_column(ForeignKey("feeders.id"), index=True)
    observed_at: Mapped[str] = mapped_column(String)
    ambient_temp_c: Mapped[float | None] = mapped_column(Float)
    rainfall_mm: Mapped[float | None] = mapped_column(Float)
    humidity_pct: Mapped[float | None] = mapped_column(Float)
    quality_flag: Mapped[str] = mapped_column(String, default="good")
    provenance: Mapped[str] = mapped_column(String, default="synthetic_weather")


class ModelMetadata(Base):
    __tablename__ = "model_metadata"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_version: Mapped[str] = mapped_column(String, unique=True)
    model_type: Mapped[str] = mapped_column(String)
    trained_at: Mapped[str] = mapped_column(String)
    feature_order_json: Mapped[str] = mapped_column(Text)
    metrics_json: Mapped[str] = mapped_column(Text)
    data_source: Mapped[str] = mapped_column(String, default="synthetic")


class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, index=True, nullable=False)
    simple_explanation: Mapped[str] = mapped_column(Text, nullable=False)
    warning_signs_json: Mapped[str] = mapped_column(Text, default="[]")
    possible_causes_json: Mapped[str] = mapped_column(Text, default="[]")
    relevant_measurements_json: Mapped[str] = mapped_column(Text, default="[]")
    safe_inspection_considerations_json: Mapped[str] = mapped_column(Text, default="[]")
    preventive_recommendations_json: Mapped[str] = mapped_column(Text, default="[]")
    source_classification: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)

