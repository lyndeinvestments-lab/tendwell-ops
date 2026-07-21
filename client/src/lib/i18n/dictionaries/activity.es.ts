import type { activityEn } from './activity.en'

/** Spanish (Latin American) strings for the activity surface. */
export const activityEs: typeof activityEn = {
  page: {
    title: 'Registro de Actividad',
    subtitle: 'Registro de auditoría de todos los cambios en la aplicación',
    today: 'Hoy',
    yesterday: 'Ayer',
    entriesCount: '{{count}} entradas',
    emptyTitle: 'Sin actividad',
    emptyDescription: 'Ningún cambio coincide con tus filtros actuales. Intenta ampliar el rango de fechas o borrar la búsqueda.',
    unknownEntity: 'Desconocido',
  },
  filters: {
    searchPlaceholder: 'Buscar…',
    from: 'Desde',
    to: 'Hasta',
    all: 'Todo',
    owners: 'Portal del Propietario',
    properties: 'Propiedades',
    pipeline: 'Pipeline',
    inspections: 'Inspecciones',
    cleaners: 'Personal de Limpieza', // REVIEW: team may prefer "Limpiadores" (see common.es.ts)
    contacts: 'Clientes',
  },
  table: {
    revert: 'Revertir',
    revertTooltip: 'Revertir a "{{value}}"',
  },
  field: {
    ce_charged: 'Cliente Cobrado', // REVIEW: internal shorthand for "Client Estimate Charged"
    cleaner_pay: 'Pago al Personal de Limpieza',
    sq_ft: 'Pies Cuadrados', // REVIEW: confirm sq ft (not sq m) is the intended unit
    square_footage: 'Pies Cuadrados', // REVIEW: confirm sq ft (not sq m) is the intended unit
    stage_id: 'Etapa',
    stage: 'Etapa',
    follow_up_date: 'Fecha de Seguimiento',
    contact_id: 'Cliente',
    bedrooms: 'Habitaciones',
    full_baths: 'Baños Completos',
    half_baths: 'Medios Baños',
    address: 'Dirección',
    notes: 'Notas',
    custom_cleans_per_month: 'Limpiezas/Mes',
    total_estimated_cost: 'Costo Total Estimado',
    estimated_profit: 'Ganancia Estimada',
    profit_percentage: '% de Ganancia',
    exclude_from_financials: 'Excluir de Finanzas',
    offboarded_at: 'Fecha de Baja',
    name: 'Nombre de la Propiedad',
    auto_code: 'Código Automático',
    door_code: 'Código de Puerta',
    wifi_info: 'Información de WiFi',
  },
  action: {
    create: 'Crear',
    update: 'Actualizar',
    delete: 'Eliminar',
    stage_change: 'Cambio de etapa',
  },
  toasts: {
    reverted: 'Se revirtió {{field}} a "{{value}}"',
    revertFailed: 'Error al revertir',
  },
}
