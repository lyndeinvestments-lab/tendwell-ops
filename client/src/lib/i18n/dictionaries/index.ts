import { commonEn } from './common.en'
import { commonEs } from './common.es'
import { issuesEn } from './issues.en'
import { issuesEs } from './issues.es'
import { propertyListEn } from './propertyList.en'
import { propertyListEs } from './propertyList.es'
import { linensEn } from './linens.en'
import { linensEs } from './linens.es'
import { weighInsEn } from './weighIns.en'
import { weighInsEs } from './weighIns.es'
import { accessCodesEn } from './accessCodes.en'
import { accessCodesEs } from './accessCodes.es'
import { acFiltersEn } from './acFilters.en'
import { acFiltersEs } from './acFilters.es'
import { verificationsEn } from './verifications.en'
import { verificationsEs } from './verifications.es'
import { inspectionsEn } from './inspections.en'
import { inspectionsEs } from './inspections.es'
import { lostItemsEn } from './lostItems.en'
import { lostItemsEs } from './lostItems.es'
import { shipmentsEn } from './shipments.en'
import { shipmentsEs } from './shipments.es'
import { cleanersEn } from './cleaners.en'
import { cleanersEs } from './cleaners.es'

/**
 * App-wide dictionary registry. Each feature area owns one namespace
 * (one `<area>.{en,es}.ts` file pair); every namespace is pre-registered
 * here so area translation PRs never edit this file. Consumers use
 * `useLocale('<namespace>')` for a scoped translator that falls back to
 * unscoped keys (e.g. `common.*`).
 */
export const dictionaryEn = {
  common: commonEn,
  issues: issuesEn,
  propertyList: propertyListEn,
  linens: linensEn,
  weighIns: weighInsEn,
  accessCodes: accessCodesEn,
  acFilters: acFiltersEn,
  verifications: verificationsEn,
  inspections: inspectionsEn,
  lostItems: lostItemsEn,
  shipments: shipmentsEn,
  cleaners: cleanersEn,
}

export const dictionaryEs: typeof dictionaryEn = {
  common: commonEs,
  issues: issuesEs,
  propertyList: propertyListEs,
  linens: linensEs,
  weighIns: weighInsEs,
  accessCodes: accessCodesEs,
  acFilters: acFiltersEs,
  verifications: verificationsEs,
  inspections: inspectionsEs,
  lostItems: lostItemsEs,
  shipments: shipmentsEs,
  cleaners: cleanersEs,
}
