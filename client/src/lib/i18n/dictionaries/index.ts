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
import { accountEn } from './account.en'
import { accountEs } from './account.es'
import { dashboardEn } from './dashboard.en'
import { dashboardEs } from './dashboard.es'
import { pipelineEn } from './pipeline.en'
import { pipelineEs } from './pipeline.es'
import { costTrackingEn } from './costTracking.en'
import { costTrackingEs } from './costTracking.es'
import { contactsEn } from './contacts.en'
import { contactsEs } from './contacts.es'
import { settingsPageEn } from './settingsPage.en'
import { settingsPageEs } from './settingsPage.es'
import { alertsEn } from './alerts.en'
import { alertsEs } from './alerts.es'
import { activityEn } from './activity.en'
import { activityEs } from './activity.es'
import { tasksEn } from './tasks.en'
import { tasksEs } from './tasks.es'
import { trellisTasksEn } from './trellisTasks.en'
import { trellisTasksEs } from './trellisTasks.es'
import { reviewsEn } from './reviews.en'
import { reviewsEs } from './reviews.es'
import { ownerPortalEn } from './ownerPortal.en'
import { ownerPortalEs } from './ownerPortal.es'
import { financialsEn } from './financials.en'
import { financialsEs } from './financials.es'
import { propertyModalEn } from './propertyModal.en'
import { propertyModalEs } from './propertyModal.es'
import { paletteEn } from './palette.en'
import { paletteEs } from './palette.es'
import { authPagesEn } from './authPages.en'
import { authPagesEs } from './authPages.es'
import { onboardingEn } from './onboarding.en'
import { onboardingEs } from './onboarding.es'

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
  account: accountEn,
  dashboard: dashboardEn,
  pipeline: pipelineEn,
  costTracking: costTrackingEn,
  contacts: contactsEn,
  settingsPage: settingsPageEn,
  alerts: alertsEn,
  activity: activityEn,
  tasks: tasksEn,
  trellisTasks: trellisTasksEn,
  reviews: reviewsEn,
  ownerPortal: ownerPortalEn,
  financials: financialsEn,
  propertyModal: propertyModalEn,
  palette: paletteEn,
  authPages: authPagesEn,
  onboarding: onboardingEn,
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
  account: accountEs,
  dashboard: dashboardEs,
  pipeline: pipelineEs,
  costTracking: costTrackingEs,
  contacts: contactsEs,
  settingsPage: settingsPageEs,
  alerts: alertsEs,
  activity: activityEs,
  tasks: tasksEs,
  trellisTasks: trellisTasksEs,
  reviews: reviewsEs,
  ownerPortal: ownerPortalEs,
  financials: financialsEs,
  propertyModal: propertyModalEs,
  palette: paletteEs,
  authPages: authPagesEs,
  onboarding: onboardingEs,
}
