-- QBO P&L snapshot: Tendwell Cleaning Co., LLC
-- Period: 2026-01-01 to 2026-09-12
-- Pulled: 2026-09-12 via scheduled Claude routine
--
-- Apply via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/data-updates/qbo_pl_data_2026-09-12.sql

UPDATE app_settings
SET value = $${
  "company": "Tendwell Cleaning Co., LLC",
  "period": "2026-01-01 to 2026-09-12",
  "updated_at": "2026-09-12T00:00:00.000Z",
  "totalIncome": 1269523.49,
  "totalCOGS": 1073286.01,
  "grossProfit": 196237.48,
  "totalExpenses": 42514.12,
  "netIncome": 153723.36,
  "incomeBreakdown": {
    "Cleaning fee": 519022.32,
    "Deliveries": 255.95,
    "Departure Clean": 327612.26,
    "Hot tub service": 785.00,
    "Onboarding Regular Clean": 8927.24,
    "Services": 60433.04,
    "Touch up Clean": 2483.00,
    "Trash Service": 1075.00,
    "Turn Clean": 348929.68
  },
  "cogsBreakdown": {
    "Cleaning Contractor Pay": 772223.92,
    "Cleaning Supplies": 57929.12,
    "Inspection Cost": 14908.42,
    "Laundry": 192318.04,
    "Leadership Pay": 26245.18,
    "Supplies Expense": 9541.33,
    "Trash Expense": 120.00
  },
  "expenseBreakdown": {
    "Advertising & marketing": 6701.38,
    "Commissions & fees": 13212.74,
    "Bank fees & service charges": 650.00,
    "Meals with clients": 29.61,
    "Travel meals": 1005.90,
    "Office expenses": 11019.41,
    "Legal fees": 1350.00,
    "Software & Subscription": 2609.70,
    "Taxes and Licenses": 2523.09,
    "Vehicle gas & fuel": 2698.44,
    "Vehicle repairs": 713.85
  },
  "monthly": {
    "Jan 2026": { "income": 70849.75,  "cogs": 60675.01,  "expenses": 1802.88,  "netIncome": 8371.86  },
    "Feb 2026": { "income": 63134.31,  "cogs": 53443.25,  "expenses": 13917.64, "netIncome": -4226.58 },
    "Mar 2026": { "income": 106973.84, "cogs": 87551.54,  "expenses": 2861.50,  "netIncome": 16560.80 },
    "Apr 2026": { "income": 129493.89, "cogs": 108191.95, "expenses": 2141.39,  "netIncome": 19160.55 },
    "May 2026": { "income": 143476.70, "cogs": 127773.65, "expenses": 2257.96,  "netIncome": 13445.09 },
    "Jun 2026": { "income": 198811.70, "cogs": 160590.48, "expenses": 2276.82,  "netIncome": 35944.40 },
    "Jul 2026": { "income": 268573.56, "cogs": 215149.37, "expenses": 1603.34,  "netIncome": 51820.85 },
    "Aug 2026": { "income": 261538.90, "cogs": 234103.07, "expenses": 4336.05,  "netIncome": 23099.78 },
    "Sep 2026": { "income": 26670.84,  "cogs": 25807.69,  "expenses": 2682.64,  "netIncome": -1819.49 }
  }
}$$
WHERE key = 'qbo_pl_data';
