import type { trellisTasksEn } from './trellisTasks.en'

/**
 * Spanish (Latin American) strings for the Trellis Tasks surface. Terminology
 * kept consistent with the rest of the app: "Tareas" for tasks, "Vencido"/
 * "Atrasada" for overdue/late, "Limpiador" for cleaner, "Propiedad" for
 * property. "Tendwell"/"Haven" workspace-source chips are brand names and
 * are intentionally left untranslated in the page.
 */
export const trellisTasksEs: typeof trellisTasksEn = {
  page: {
    title: 'Tareas de Trellis',
    subtitle: 'Tareas de limpieza y operaciones del snapshot de Trellis - sincronizadas cada hora.',
    syncedPrefix: 'Sincronizado {{date}}',
    notSyncedYet: 'Aún no sincronizado',
    refresh: 'Actualizar',
    errorTitle: 'No se pudieron cargar las tareas de Trellis',
  },
  tiles: {
    overdue: 'Vencidas',
    overdueSubtitleUnassigned: '+{{count}} sin asignar y vencidas',
    overdueSubtitleDefault: 'asignadas, vencidas',
    dueToday: 'Vencen Hoy',
    turnCleansToday: 'Limpiezas de Cambio Hoy', // REVIEW: "turn clean" → "limpieza de cambio"?
    turnCleansSubtitle: '{{done}} hechas · {{open}} abiertas',
    completedToday: 'Completadas Hoy',
    completedTodaySubtitle: 'de lo programado hoy',
  },
  roster: {
    heading: 'En Trellis, no en Ops',
    peopleCount: '{{count}} personas',
    hideDismissed: 'Ocultar descartados',
    showDismissed: 'Mostrar descartados ({{count}})',
    noName: '(sin nombre)',
    noEmail: 'sin correo',
    addTitle: 'Agregar a la lista de personal de limpieza de Ops',
    add: 'Agregar',
    dismissTitle: 'Descartar - ocultar a esta persona de la lista',
    dismiss: 'Descartar',
    allDismissed: 'Todos los demás fueron descartados - nada que revisar.',
    dismissedHeading: 'Descartados',
    restore: 'Restaurar',
  },
  toasts: {
    addedTitle: '{{name}} agregado(a) a Personal de Limpieza',
    addedDescription: 'Configura la tarifa de pago y envía una invitación a la app desde la página de Personal de Limpieza.',
    addFailedTitle: 'No se pudo agregar al limpiador',
    dismissedTitle: '{{name}} descartado(a)',
    dismissFailedTitle: 'No se pudo descartar',
    restoredTitle: '{{name}} restaurado(a)',
    restoreFailedTitle: 'No se pudo restaurar',
    syncStartedTitle: 'Sincronización iniciada',
    syncStartedDescription: 'Las tareas se actualizan en uno o dos minutos - los datos se actualizan automáticamente.',
    syncFailedTitle: 'No se pudo iniciar la sincronización',
  },
  filters: {
    tabs: {
      overdue: 'Vencidas',
      today: 'Vencen Hoy',
      completed: 'Completadas',
      all: 'Todas',
    },
    turnCleansOnly: 'Solo limpiezas de cambio', // REVIEW: "turn clean" → "limpieza de cambio"?
    includeUnassigned: 'Incluir sin asignar ({{count}})',
    includeUnassignedTitle: 'Trellis agrupa las tareas en manos del proveedor y sin asignar por separado de Vencidas - actívalo para verlas también aquí.',
    searchPlaceholder: 'Buscar propiedad, tarea, responsable…',
  },
  table: {
    property: 'Propiedad',
    task: 'Tarea',
    status: 'Estado',
    due: 'Vence',
    assignee: 'Responsable',
    source: 'Origen',
    openInTrellis: 'Abrir esta tarea en Trellis',
    openInTrellisAria: 'Abrir en Trellis',
    daysLate: '{{count}}d atrasada',
    dueDay: 'Vence {{date}}',
    unassignedFallback: 'sin asignar',
    emptyTitle: 'No hay tareas aquí',
    emptyOverdue: 'Nada vencido - todo al día.',
    emptyFiltered: 'Ninguna tarea coincide con los filtros actuales.',
  },
  status: {
    scheduled: 'Programada',
    open: 'Abierta',
    completed: 'Completada',
    unknown: 'Desconocido',
  },
}
