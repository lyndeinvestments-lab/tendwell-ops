import type { acFiltersEn } from './acFilters.en'

/** Spanish (Latin American) strings for the ac-filters surface. */
export const acFiltersEs: typeof acFiltersEn = {
  page: {
    title: 'Filtros de A/C',
    subtitle: 'Controla los tamaños de filtro y los calendarios de cambio: haz clic en las celdas para editar',
    allStatuses: 'Todos los Estados',
    searchPlaceholder: 'Buscar…',
    bulkEdit: 'Edición Masiva',
    exitBulk: 'Salir de Edición Masiva',
    importCsv: 'Importar CSV',
  },
  tiles: {
    totalTracked: 'Total Registrado', // REVIEW: "Registrado" vs "Rastreado" for "Tracked"
    overdue: 'Vencido',
    dueSoon: 'Próximo a Vencer (14 d)',
    missingFilterSize: 'Tamaño de Filtro Faltante',
  },
  bulk: {
    selected: '{{count}} seleccionados',
    filterSizePlaceholder: 'Tamaño de filtro…',
    setSize: 'Establecer Tamaño',
    markChangedToday: 'Marcar Cambiado Hoy',
  },
  table: {
    filterSize: 'Tamaño de Filtro',
    lastChanged: 'Último Cambio',
    nextDue: 'Próximo Vencimiento',
    due: 'Vence',
    addSizePlaceholder: 'Agregar tamaño…',
    addNotesPlaceholder: 'Agregar notas…',
    todayButton: 'Hoy',
    markChangedTooltip: 'Marcar el filtro como cambiado hoy y establecer la próxima fecha de vencimiento',
    emptyTitle: 'No se encontraron propiedades',
    emptyDescription: 'Ninguna propiedad coincide con tus filtros actuales.',
    overdueBadge: 'VENCIDO',
  },
  status: {
    overdue: 'Vencido',
    due_soon: 'Próximo a Vencer',
    ok: 'OK', // REVIEW: kept as "OK" (widely used as-is in LatAm Spanish); could use "Bien" if the team prefers
  },
  toasts: {
    editAccessRequired: 'Se requiere acceso de edición',
    saved: 'Guardado',
    updateFailed: 'Error al actualizar',
    filterMarkedChanged: 'Filtro marcado como cambiado hoy',
    nextDueDescription: 'Próximo vencimiento: {{date}}',
    bulkUpdateFailed: 'Error en la actualización masiva',
    filterSizeUpdated: 'Tamaño de filtro actualizado para {{count}} propiedades',
    bulkMarkedChanged: '{{count}} filtros marcados como cambiados hoy',
    csvParseFailed: 'Error al leer el CSV',
    csvImported: 'Se importaron {{updated}} de {{total}} filas',
  },
  csvDialog: {
    title: 'Importar Datos de Filtros de A/C',
    foundRows: 'Se encontraron {{count}} filas. Columnas: Propiedad, Tamaño de Filtro, Último Cambio',
    matchingNote: 'La coincidencia es por nombre exacto de propiedad. Las filas sin coincidencia serán omitidas.',
    moreRows: '…y {{count}} más',
    importRows: 'Importar {{count}} Filas',
  },
}
