// Cleaner minimum pay by bedroom count. The table lives in shared/ so the MCP
// connector's quote tool reads the same figures as the property modal and the
// quote sheet; this module keeps the existing import path for the client.
export { CLEANER_MIN_BY_BEDROOMS, cleanerMinForBedrooms } from '@shared/quote-pricing'
