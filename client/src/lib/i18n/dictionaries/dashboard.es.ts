import type { dashboardEn } from './dashboard.en'

/**
 * Spanish (Latin American) strings for the dashboard surface. Typed as
 * `typeof dashboardEn` so TypeScript enforces key parity. Terminology
 * follows `common.es.ts`'s pipeline-stage translations (Incorporación /
 * Activa / En Salida) and `propertyList.es.ts`'s conventions (Pies², Habs.)
 * so the KPI tiles and stage displays read consistently with the rest of
 * the app.
 */
export const dashboardEs: typeof dashboardEn = {
  page: {
    title: 'Panel',
    subtitle: 'Resumen operativo',
    errorTitle: 'Error al cargar los datos del panel',
  },
  hero: {
    monthlyRevenue: 'Ingresos Mensuales (activas)',
    portfolio: 'Portafolio',
    activeOfTotal: 'activas de {{total}} propiedades',
    profitLabel: 'de ganancia',
    marginLabel: 'de margen',
    profitMix: 'Mezcla de ganancia activa',
    propsCount: '{{count}} propiedades',
  },
  filterBar: {
    sevenDays: '7 Días',
    thirtyDays: '30 Días',
    ninetyDays: '90 Días',
    custom: 'Personalizado',
    fromDateAria: 'Fecha desde',
    toDateAria: 'Fecha hasta',
    to: 'a',
    showingRange: 'Mostrando {{from}}-{{to}}',
  },
  period: {
    sevenDays: '7 días',
    thirtyDays: '30 días',
    ninetyDays: '90 días',
  },
  todayActions: {
    title: 'Acciones de Hoy',
    empty: 'Todo al día - nada requiere acción hoy.',
    followUpOverdue: 'Seguimiento vencido',
    followUpDueToday: 'Seguimiento vence hoy',
    badgeOverdue: 'Vencido',
    badgeToday: 'Hoy',
    badgeStalled: 'Estancado',
    viewAllAlerts: 'Ver todas las alertas →',
  },
  attention: {
    title: 'Necesita Atención',
    empty: 'Sin problemas de datos - todas las propiedades activas se ven bien.',
    negativeProfitChip: '{{count}} con ganancia negativa',
    viewAllCount: 'Ver todas ({{count}}) →',
    missingDataChip: '{{count}} con datos faltantes',
    fixButton: 'Corregir',
    missingFields: {
      ce: 'CE', // REVIEW: unclear abbreviation (likely "Cargo Estimado" / ce_charged) - confirm with team before finalizing
      pay: 'Pago',
      sqft: 'Pies²',
      beds: 'Habs.',
      address: 'Dirección',
    },
  },
  tiles: {
    totalProperties: 'Propiedades Totales',
    conversions: 'Conversiones',
    conversionsSubtitle: 'en {{period}}',
    conversionsHint: 'Propiedades que pasaron a la etapa Activa durante este período',
    avgOnboarding: 'Incorporación Prom.',
    noData: 'Sin datos',
    avgOnboardingSubtitleConversion: 'días a activa (este período)',
    avgOnboardingSubtitleCurrent: 'días en curso ({{count}} abiertas)',
    avgOnboardingSubtitleNoData: 'aún sin transiciones',
    avgOnboardingHintConversion: 'Promedio de días de Incorporación a Activa para las conversiones en el período seleccionado.',
    avgOnboardingHintCurrent: 'No hubo conversiones en el período seleccionado - se muestra cuánto tiempo llevan en Incorporación las propiedades que están ahí actualmente.',
    avgOnboardingHintNoData: 'No se registró actividad de incorporación. Una propiedad necesita al menos un registro en stage_transitions para aparecer aquí.',
    trellisTasksToday: 'Tareas de Trellis Hoy',
    trellisUnavailable: 'No disponible',
    trellisAsOf: 'a las {{time}}',
    trellisDueToday: 'hoy',
    trellisDue: 'vence {{date}}',
    trellisErrorHint: 'No se pudo cargar la instantánea de Trellis: {{message}}',
    trellisHint: 'Tareas de Trellis abiertas que vencen hoy (América/Chicago), contadas desde la instantánea sincronizada. Haz clic para ver el rastreador completo de tareas.',
  },
  activityMetrics: {
    newProperties: 'Propiedades Nuevas ({{period}})',
    newPropertiesEmpty: 'No hay propiedades nuevas en este período',
    offboarded: 'Dadas de Baja ({{period}})',
    offboardedEmpty: 'No hay propiedades dadas de baja en este período',
    viewAll: 'Ver Todas →',
  },
  insights: {
    profitDistribution: 'Distribución de Ganancia (Activas)',
    currentSuffix: '(actual)',
    profitDistributionEmpty: 'No hay propiedades activas con datos financieros.',
    propertiesByStage: 'Propiedades por Etapa',
    recentTransitions: 'Transiciones Recientes ({{period}})',
    recentTransitionsEmpty: 'No hay transiciones en este período',
    viewAllTransitions: 'Ver Todas las Transiciones →',
    newStageFallback: 'Nueva',
  },
  quality: {
    title: 'Tabla de Calidad',
    emptyTitle: 'Aún no se han registrado inspecciones',
    emptyDescription: 'Registra al menos 3 inspecciones para ver tus propiedades con mejor y peor desempeño, clasificadas por puntaje.',
    logFirstInspection: 'Registrar Primera Inspección',
    topPerformers: 'Mejor Desempeño',
    needsAttention: 'Necesita Atención',
  },
  scheduled: {
    title: 'Programadas Esta Semana',
    subtitle: 'asignaciones de limpieza',
    setupAssignments: 'Configurar asignaciones →',
    qualityAlertsTitle: 'Alertas de Calidad',
  },
  crm: {
    title: 'Resumen de CRM',
    totalClients: 'Clientes Totales',
    new30Days: 'Nuevos (30 días)',
    unassignedProperties: 'Propiedades Sin Asignar',
    noClientsYet: 'Aún no hay clientes.',
    importFromProperties: 'Importar desde Propiedades →',
    paymentMethods: 'Métodos de Pago',
    unknownPaymentMethod: 'Desconocido',
  },
}
