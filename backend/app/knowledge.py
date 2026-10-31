from __future__ import annotations

import json
from typing import Any

from app.database import database, utc_now


REFERENCE_SOURCE = "Demo Knowledge / Reference Guidance"
VERIFIED_SOURCE = "Supervisor-Verified Repair Outcome"


def _entry(
    number: int,
    title: str,
    category: str,
    explanation: str,
    warning_signs: list[str],
    possible_causes: list[str],
    measurements: list[str],
    safety: list[str],
    prevention: list[str],
) -> dict[str, Any]:
    return {
        "id": f"KB-REF-{number:03d}",
        "title": title,
        "category": category,
        "simple_explanation": explanation,
        "warning_signs": warning_signs,
        "possible_causes": possible_causes,
        "relevant_measurements": measurements,
        "safe_inspection_considerations": safety,
        "preventive_recommendations": prevention,
    }


REFERENCE_ENTRIES = [
    _entry(1, "What a distribution transformer does", "Transformer Fundamentals", "A distribution transformer reduces feeder voltage to a level suitable for local consumers. GridGuard uses fictional assets to demonstrate how condition and service information can be reviewed together.", ["Repeated local supply interruptions", "Unusual noise or visible enclosure damage"], ["Upstream supply issue", "Overload", "Age-related deterioration"], ["Load percentage", "Voltage", "Oil temperature"], ["Keep the public outside the secured equipment area", "Inspection must be performed by qualified personnel under the utility safety procedure"], ["Maintain clear asset records", "Review loading and maintenance history together"]),
    _entry(2, "Understanding transformer load percentage", "Transformer Fundamentals", "Load percentage compares estimated demand with rated capacity. Sustained high loading can increase heat and accelerate wear, but one elevated reading does not by itself diagnose a fault.", ["Repeated high-load alerts", "Rising oil temperature during peak demand"], ["Demand growth", "Uneven load distribution", "Temporary peak usage"], ["Current load percentage", "24-hour average load", "Rated capacity"], ["Use remote or approved metering data where available", "Do not approach exposed or damaged electrical equipment"], ["Review peak-demand trends", "Plan approved load balancing where engineering review supports it"]),
    _entry(3, "Oil temperature as a condition signal", "Condition Monitoring", "Oil temperature helps indicate transformer thermal stress. It should be interpreted with ambient temperature, loading, history, and sensor quality rather than as a stand-alone diagnosis.", ["Sustained temperature rise", "Temperature remains high after demand falls"], ["High loading", "Cooling limitation", "Sensor or data-quality issue"], ["Oil temperature", "Ambient temperature", "Load percentage", "Six-hour temperature change"], ["Treat leaks, smoke, or fire as an emergency and keep a safe distance", "Qualified staff should follow approved isolation and inspection procedures"], ["Trend temperature against load", "Review cooling condition during scheduled maintenance"]),
    _entry(4, "Ambient temperature and weather context", "Condition Monitoring", "Ambient heat and rainfall can change operating conditions and the meaning of other measurements. Weather context supports review but does not prove the cause of an electrical event.", ["Temperature rise during hot periods", "Weather-related clusters of complaints"], ["High ambient heat", "Moisture exposure", "Coincidental demand changes"], ["Ambient temperature", "Rainfall", "Oil temperature", "Complaint timestamps"], ["Delay non-emergency site activity during unsafe weather", "Use approved weather and access-risk procedures"], ["Correlate weather with condition trends", "Keep drainage and access observations in maintenance records"]),
    _entry(5, "Using recent fault history", "Condition Monitoring", "Recent fault counts provide context about recurrence. They identify assets that deserve review, but categories and records must be checked before assuming events share one cause.", ["Several events on the same asset", "Shortening time between interruptions"], ["Unresolved underlying issue", "Different unrelated events", "Incomplete records"], ["Faults in the last 90 days", "Event category", "Repair and verification records"], ["Review records before field work", "Use the current approved work order and hazard assessment"], ["Compare recurring symptoms", "Escalate repeated events for engineering review"]),
    _entry(6, "Rainfall and moisture exposure", "Condition Monitoring", "Rainfall is a synthetic context feature in GridGuard. It can support a review of moisture-related risk but is not evidence that moisture caused a fault.", ["Events clustered after heavy rain", "Visible water ingress reported from a safe location"], ["Drainage problem", "Damaged enclosure", "Unrelated feeder disturbance"], ["Rainfall", "Humidity where available", "Inspection observations"], ["Do not enter flooded electrical areas", "Report damaged or wet equipment and await qualified response"], ["Maintain drainage around approved access areas", "Record weather context with incidents"]),
    _entry(7, "Routine visual condition review", "Preventive Maintenance", "A scheduled condition review records externally observable deterioration and compares it with prior maintenance history. It is not a substitute for an approved technical inspection.", ["Damaged enclosure", "Oil staining", "Obstructed access", "Vegetation encroachment"], ["Weathering", "Impact damage", "Maintenance backlog"], ["Condition photos", "Last maintenance date", "Open recommendations"], ["Observe only from an authorized safe area", "Never touch equipment or cross barriers without authorization"], ["Keep access areas clear through approved work", "Track observations to closure"]),
    _entry(8, "Responding to overheating indicators", "Preventive Maintenance", "An overheating indicator should trigger evidence review and prioritization. Load, ambient conditions, sensor quality, and recent history help determine the appropriate qualified response.", ["High oil-temperature alert", "Temperature rising faster than usual", "Heat-related odor reported by trained staff"], ["Overload", "Cooling limitation", "Loose connection", "Faulty sensor"], ["Oil temperature", "Load percentage", "Temperature change", "Sensor quality flag"], ["Smoke or fire requires emergency escalation and a safe exclusion area", "Only qualified staff may inspect under approved isolation controls"], ["Review thermal trends", "Address repeat overloads through approved planning"]),
    _entry(9, "Load imbalance review", "Preventive Maintenance", "Uneven demand can place additional stress on parts of the network. GridGuard can flag phase-imbalance observations for engineering review without prescribing switching actions.", ["Repeated imbalance readings", "Voltage-quality complaints"], ["Uneven connected demand", "Connection issue", "Measurement error"], ["Phase imbalance percentage", "Current", "Voltage", "Complaint pattern"], ["Do not make switching or connection changes from dashboard guidance", "Use qualified engineering and field authorization"], ["Review demand allocation", "Validate measurement quality before planning changes"]),
    _entry(10, "Protective-device issue overview", "Preventive Maintenance", "Protective devices help limit damage when abnormal conditions occur. A trip or fuse-related symptom requires qualified diagnosis because the operation may be a consequence rather than the root cause.", ["Repeated trips", "Supply loss affecting one service area", "Protective-device alert"], ["Downstream fault", "Overload", "Device deterioration"], ["Event sequence", "Load before interruption", "Fault and maintenance history"], ["Never bypass or reset protection based on this guidance", "Follow approved isolation, testing, and authorization procedures"], ["Investigate repeat operations", "Keep protection-maintenance records current"]),
    _entry(11, "Recording an outage complaint", "Complaint Handling", "A useful outage complaint captures the affected village, approximate area, duration, visible hazards reported from a safe distance, and a secure reference for follow-up.", ["Complete loss of supply", "Multiple nearby reports", "Visible hazard reported"], ["Local transformer event", "Feeder interruption", "Premises-level issue"], ["Reported time", "Village", "Affected area", "Related complaint count"], ["Tell callers to keep away from damaged equipment", "Use emergency channels for fire, fallen wires, or immediate danger"], ["Record consistent categories", "Protect caller information", "Group likely duplicates"]),
    _entry(12, "Flickering or unstable supply reports", "Complaint Handling", "Flickering reports can help identify intermittent service quality issues. Several reports in one area are more useful than one isolated description, but field verification is still required.", ["Repeated flickering", "Reports from several nearby consumers", "Coincident voltage variation"], ["Loose connection", "Voltage variation", "Local premises issue", "Upstream disturbance"], ["Complaint times", "Voltage trend", "Affected area", "Transformer association"], ["Advise callers not to inspect electrical equipment", "Escalate visible sparking, smoke, or fallen conductors as emergencies"], ["Correlate reports by time and location", "Retain verified resolution notes"]),
    _entry(13, "Sparking, smoke, or fire complaint", "Complaint Handling", "Reports of sparking, smoke, fire, or fallen conductors are urgent safety signals. The priority is public separation and emergency escalation, not remote diagnosis.", ["Visible sparking", "Smoke or flame", "Fallen wire", "Burning odor"], ["Equipment damage", "Vegetation contact", "Connection failure", "External impact"], ["Report location", "Time", "Safe-distance observations"], ["Keep people away and use the local emergency process", "Do not touch equipment, wires, fences, or nearby objects"], ["Keep emergency contacts current", "Review verified incident findings after closure"]),
    _entry(14, "Understanding complaint status", "Complaint Handling", "Complaint tracking shows progress from receipt through incident linking, assignment, investigation, restoration, and verified closure. A status update communicates workflow progress, not a guarantee of repair time.", ["Status unchanged beyond the expected review window", "Conflicting incident and work-order states"], ["Awaiting dispatch", "Field assessment in progress", "Verification pending"], ["Complaint updated time", "Incident status", "Work-order status"], ["Use the secure complaint reference for public tracking", "Do not expose other callers or complaint lists"], ["Update status after meaningful transitions", "Provide cautious ETA language"]),
    _entry(15, "Building an incident report", "Reporting", "An incident report should preserve the event timeline, affected assets, complaints, operational decisions, evidence, repair record, and independent verification with clear synthetic or real provenance.", ["Missing timestamps", "Unlinked work order", "Unclear evidence provenance"], ["Incomplete workflow capture", "Manual-entry gap", "Unlinked records"], ["Opened and restored times", "Status history", "Related references"], ["Exclude personal caller details", "Use only authorized evidence and access controls"], ["Use consistent references", "Complete review before closure"]),
    _entry(16, "Work-order status lifecycle", "Work Orders", "A field work order moves through assignment, acceptance, travel, arrival, investigation, repair, verification, resolution, and closure. Recorded transitions support accountability and replay.", ["Skipped transition", "Work without assigned responsibility", "Closure without verification"], ["Process gap", "Delayed update", "Insufficient evidence"], ["Transition timestamps", "Assigned roles", "Supervisor decision"], ["Status changes do not replace field authorization or safety controls", "Stop-work conditions take precedence over workflow timing"], ["Record transitions promptly", "Require independent approval before closure"]),
    _entry(17, "Safe inspection planning", "Work Orders", "Inspection planning identifies the asset, known hazards, required authorization, evidence to collect, and stop-work conditions before qualified personnel begin.", ["Unknown asset identity", "Uncontrolled public access", "Weather or fire hazard"], ["Incomplete dispatch information", "Changed site conditions", "Insufficient access control"], ["Asset ID", "Hazard flags", "Weather context", "Work-order scope"], ["Follow the utility's approved isolation and lockout procedures", "Do not use dashboard guidance as permission to work on energized equipment"], ["Confirm asset and scope before dispatch", "Document hazards and stop-work decisions"]),
    _entry(18, "Repair verification and closure", "Work Orders", "A repair should be independently reviewed against the work order, observations, evidence, remaining issues, and restoration record before the case becomes a verified outcome.", ["Missing after-evidence", "Unresolved issue", "Restoration not confirmed"], ["Incomplete repair report", "Need for rework", "Evidence mismatch"], ["Repair submission time", "Supervisor decision", "Restoration observations"], ["Verification must be performed by an authorized reviewer", "Rework follows a new approved safety assessment"], ["Separate repair completion from approval", "Promote only approved outcomes to verified knowledge"]),
    _entry(19, "Grouping complaints into one incident", "Incident Response", "Reports close in time and service area may describe one incident. Grouping reduces duplicate dispatch while retaining each complaint reference for secure tracking.", ["Several reports on one feeder", "Similar symptoms within a short period"], ["Single transformer event", "Feeder-level interruption", "Coincidental separate issues"], ["Report time", "Transformer and feeder association", "Village", "Symptom category"], ["Do not disclose one caller's information to another", "Escalate immediate hazards separately even when grouping"], ["Use deterministic grouping rules", "Allow operators to review uncertain localization"]),
    _entry(20, "Restoration and incident closure", "Incident Response", "Restoration records when service recovery is reported; closure follows completion of required work and verification. Keeping these stages separate prevents premature completion claims.", ["Restored incident with open work", "Complaint remains unresolved", "Verification pending"], ["Partial restoration", "Outstanding rework", "Delayed status update"], ["Restored time", "Work-order status", "Supervisor decision", "Latest complaint update"], ["Restoration status does not authorize further field work", "Follow approved re-energization and verification procedures"], ["Reconcile linked records before closure", "Document remaining issues and follow-up"]),
]


def seed_reference_knowledge() -> None:
    created_at = utc_now()
    with database() as conn:
        for item in REFERENCE_ENTRIES:
            conn.execute(
                """INSERT OR IGNORE INTO knowledge_entries(
                id,title,category,simple_explanation,warning_signs_json,possible_causes_json,
                relevant_measurements_json,safe_inspection_considerations_json,
                preventive_recommendations_json,source_classification,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    item["id"], item["title"], item["category"], item["simple_explanation"],
                    json.dumps(item["warning_signs"]), json.dumps(item["possible_causes"]),
                    json.dumps(item["relevant_measurements"]), json.dumps(item["safe_inspection_considerations"]),
                    json.dumps(item["preventive_recommendations"]), REFERENCE_SOURCE, created_at,
                ),
            )


def _decode_reference(row: Any) -> dict[str, Any]:
    item = dict(row)
    for field in (
        "warning_signs", "possible_causes", "relevant_measurements",
        "safe_inspection_considerations", "preventive_recommendations",
    ):
        item[field] = json.loads(item.pop(f"{field}_json"))
    item["entry_type"] = "reference_guidance"
    return item


def _verified_entry(row: Any) -> dict[str, Any]:
    source = dict(row)
    return {
        **source,
        "id": f"KB-VER-{source['id']:04d}",
        "legacy_id": source["id"],
        "entry_type": "verified_repair",
        "title": f"{source['fault_category']} — {source['transformer_id']}",
        "category": source["fault_category"],
        "simple_explanation": source["verified_root_cause"],
        "warning_signs": [source["symptoms"]] if source.get("symptoms") else [],
        "possible_causes": [source["verified_root_cause"]],
        "relevant_measurements": [source["inspection_findings"]] if source.get("inspection_findings") else [],
        "safe_inspection_considerations": ["Use the approved work order, recorded hazard controls, and qualified personnel for any follow-up."],
        "preventive_recommendations": [],
        "source_classification": VERIFIED_SOURCE,
        "created_at": source["verified_at"],
    }


def list_knowledge(search: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
    with database() as conn:
        references = [_decode_reference(row) for row in conn.execute("SELECT * FROM knowledge_entries ORDER BY category,title")]
        verified = [_verified_entry(row) for row in conn.execute("SELECT * FROM verified_faults ORDER BY verified_at DESC")]

    entries = references + verified
    if category:
        entries = [item for item in entries if item["category"].casefold() == category.casefold()]
    if search:
        needle = search.casefold()
        entries = [
            item for item in entries
            if needle in json.dumps(item, ensure_ascii=False).casefold()
        ]
    return entries
