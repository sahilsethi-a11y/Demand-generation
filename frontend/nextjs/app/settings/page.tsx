"use client";

import { useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

type SettingField = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "number" | "select";
  options?: string[];
  tip?: string;
};

const API_KEY_FIELDS: SettingField[] = [
  { key: "APIFY_API_TOKEN", label: "Apify Token", placeholder: "apify_api_…", type: "password", tip: "Required for all job search actors" },
  { key: "APOLLO_API_KEY", label: "Apollo API Key", placeholder: "apollo_api_…", type: "password", tip: "Required for ICP discovery and email enrichment" },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", placeholder: "sk-…", type: "password", tip: "Required for email generation" },
  { key: "INSTANTLY_API_KEY", label: "Instantly API Key", placeholder: "inst_…", type: "password", tip: "Required for sending leads to Instantly campaigns" },
];

const CAMPAIGN_FIELDS: SettingField[] = [
  { key: "INSTANTLY_CAMPAIGN_ID", label: "Instantly Campaign ID", placeholder: "65e808d0-…", tip: "The campaign to add leads to when auto-send is enabled" },
];

const SENDER_FIELDS: SettingField[] = [
  { key: "SENDER_NAME", label: "Your Name", placeholder: "Sahil Mehta" },
  { key: "SENDER_TITLE", label: "Your Title", placeholder: "Head of Partnerships" },
  { key: "SENDER_COMPANY", label: "Company", placeholder: "EMB Global" },
];

const PIPELINE_DEFAULTS: SettingField[] = [
  { key: "DEFAULT_MAX_COMPANIES", label: "Max Companies per Run", placeholder: "20", type: "number" },
  { key: "DEFAULT_MAX_ICPS", label: "Max ICPs per Company", placeholder: "5", type: "number" },
  { key: "DEFAULT_MARKET", label: "Default Market", type: "select", options: ["us", "india"], placeholder: "us" },
  { key: "DEFAULT_DATE_FILTER", label: "Default Date Range", type: "select", options: ["7d", "30d"], placeholder: "7d" },
];

function SettingRow({ field, value, onChange }: {
  field: SettingField;
  value: string;
  onChange: (val: string) => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="flex items-start gap-4 py-4 border-b border-brand-border last:border-b-0">
      <div className="w-52 flex-shrink-0">
        <label className="text-sm font-medium text-brand-secondary">{field.label}</label>
        {field.tip && <p className="text-xs text-slate-400 mt-0.5">{field.tip}</p>}
      </div>
      <div className="flex-1 flex items-center gap-2">
        {field.type === "select" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
          >
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input
            type={field.type === "password" && !show ? "password" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="flex-1 px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary font-mono"
          />
        )}
        {field.type === "password" && (
          <button
            onClick={() => setShow((s) => !s)}
            className="text-slate-400 hover:text-slate-600 text-xs px-2 py-2 rounded border border-brand-border"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsSection({ title, fields, values, onChange }: {
  title: string;
  fields: SettingField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm mb-6">
      <div className="px-6 py-4 border-b border-brand-border bg-slate-50">
        <h2 className="text-sm font-semibold text-brand-secondary">{title}</h2>
      </div>
      <div className="px-6">
        {fields.map((field) => (
          <SettingRow
            key={field.key}
            field={field}
            value={values[field.key] || ""}
            onChange={(val) => onChange(field.key, val)}
          />
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("emb_settings");
      if (stored) setValues(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() {
    try {
      localStorage.setItem("emb_settings", JSON.stringify(values));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Settings</h1>
            <p className="text-slate-500 text-sm mt-0.5">Configure API keys, sender identity, and pipeline defaults</p>
          </div>
          <button
            onClick={handleSave}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              saved ? "bg-green-600 text-white" : "bg-brand-primary text-white hover:bg-blue-800"
            }`}
          >
            {saved ? "Saved ✓" : "Save Settings"}
          </button>
        </div>

        <SettingsSection title="API Keys" fields={API_KEY_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Campaign Configuration" fields={CAMPAIGN_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Sender Identity" fields={SENDER_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Pipeline Defaults" fields={PIPELINE_DEFAULTS} values={values} onChange={handleChange} />

        {/* Actor reference */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-brand-border bg-slate-50">
            <h2 className="text-sm font-semibold text-brand-secondary">Apify Actor Reference</h2>
          </div>
          <div className="px-6 py-5 space-y-3 text-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">US Market</p>
            {[
              { name: "Greenhouse", id: "fantastic-jobs/greenhouse-jobs-api", cost: "$1.20 / 1K jobs" },
              { name: "Ashby", id: "fantastic-jobs/ashby-jobs-api", cost: "$45 / mo flat" },
              { name: "Lever", id: "jobo.world/lever-jobs-search", cost: "$0.10 / 1K jobs" },
            ].map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1.5">
                <span className="font-medium text-brand-secondary">{a.name}</span>
                <div className="flex items-center gap-4">
                  <code className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{a.id}</code>
                  <span className="text-xs text-slate-400">{a.cost}</span>
                </div>
              </div>
            ))}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 pt-3 border-t border-brand-border">India Market</p>
            {[
              { name: "LinkedIn", id: "bebity/linkedin-jobs-scraper", cost: "$29.99/mo + usage" },
              { name: "Naukri", id: "easyapi/naukri-jobs-scraper", cost: "$0.99 / 1K jobs" },
              { name: "Indeed", id: "borderline/indeed-scraper", cost: "$5.00 / 1K jobs" },
            ].map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1.5">
                <span className="font-medium text-brand-secondary">{a.name}</span>
                <div className="flex items-center gap-4">
                  <code className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{a.id}</code>
                  <span className="text-xs text-slate-400">{a.cost}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
