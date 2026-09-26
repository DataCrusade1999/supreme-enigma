import type { IndicatorDef } from "./types";

// Filters verified against MoSPI on 2026-09-26 and pinned by indicators.test.ts
// against responses recorded that day. Each definition is one query against one
// base year; when MoSPI rebases a dataset, update it here (spec §6.2).
export const DEFAULT_INDICATORS: IndicatorDef[] = [
  {
    id: "cpi-headline",
    label: "Retail inflation",
    dataset: "CPI",
    filters: { base_year: "2024", series: "Current", state_code: "1", sector_code: "3", division_code: "0" },
    valueField: "inflation",
    unit: "%",
  },
  {
    id: "cpi-food",
    label: "Food and beverages inflation",
    dataset: "CPI",
    filters: { base_year: "2024", series: "Current", state_code: "1", sector_code: "3", division_code: "1" },
    valueField: "inflation",
    unit: "%",
    // The division's own row; the rest are its groups, classes and sub-classes.
    match: { code: "01" },
  },
  {
    id: "iip",
    label: "IIP growth",
    dataset: "IIP",
    filters: { base_year: "2022-23", frequency: "Monthly", type: "General" },
    valueField: "growth_rate",
    unit: "%",
  },
  {
    id: "gdp",
    label: "GDP growth (real)",
    dataset: "NAS",
    filters: { base_year: "2022-23", series: "Current", frequency_code: "Quarterly", indicator_code: "22" },
    valueField: "constant_price",
    unit: "%",
  },
  {
    id: "unemployment-urban",
    label: "Unemployment (urban)",
    dataset: "PLFS",
    // Monthly, which runs from 2025 and is current; the quarterly series stops
    // at Oct–Dec 2025. Monthly figures are current weekly status by construction.
    filters: {
      indicator_code: "3",
      frequency_code: "3",
      state_code: "99",
      gender_code: "3",
      age_code: "1",
      sector_code: "2",
    },
    valueField: "value",
    unit: "%",
  },
];
