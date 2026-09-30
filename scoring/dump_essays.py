#!/usr/bin/env python3
"""Dump all essays from the database to individual JSON files."""
import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'prisma', 'dev.db')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'essays')

os.makedirs(OUTPUT_DIR, exist_ok=True)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# Get all essays with student and topic info
rows = conn.execute("""
    SELECT
        e.id, e.title, e.rawText,
        s.name as studentName,
        t.title as topicTitle, t.requirements as topicRequirements
    FROM Essay e
    LEFT JOIN Student s ON e.studentId = s.id
    LEFT JOIN Topic t ON e.matchedTopicId = t.id
    WHERE e.rawText IS NOT NULL AND length(e.rawText) > 0
""").fetchall()

manifest = []
for row in rows:
    essay_data = {
        "id": row["id"],
        "title": row["title"],
        "studentName": row["studentName"],
        "topicTitle": row["topicTitle"],
        "topicRequirements": row["topicRequirements"],
        "rawText": row["rawText"],
    }
    filename = f"{row['id']}.json"
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(essay_data, f, ensure_ascii=False, indent=2)
    manifest.append({
        "id": row["id"],
        "file": filename,
        "student": row["studentName"],
        "topic": row["topicTitle"],
        "charCount": len(row["rawText"]) if row["rawText"] else 0,
    })

# Write manifest
manifest_path = os.path.join(OUTPUT_DIR, '_manifest.json')
with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

conn.close()
print(f"Dumped {len(manifest)} essays to {OUTPUT_DIR}")
print(f"Manifest: {manifest_path}")
