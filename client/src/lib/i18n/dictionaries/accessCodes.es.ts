import type { accessCodesEn } from './accessCodes.en'

/** Spanish (Latin American) strings for the access-codes surface. */
export const accessCodesEs: typeof accessCodesEn = {
  page: {
    title: 'Códigos de Acceso',
    subtitle: 'Haz clic en cualquier campo para editar; usa el ícono de copiar para el portapapeles',
    searchPlaceholder: 'Buscar…',
    clearSearch: 'Borrar búsqueda',
    emptyTitle: 'No se encontraron propiedades',
    emptyDescription: 'Ninguna propiedad coincide con tus filtros actuales.',
  },
  stats: {
    totalProperties: 'Total de Propiedades',
    hasCode: 'Con Código',
    missingCode: 'Sin Código',
    autoCode: 'Código Automático',
  },
  table: {
    stage: 'Etapa',
    autoCode: 'Código Automático',
    doorCode: 'Código de Puerta',
    otherCodes: 'Otros Códigos',
    wifiInfo: 'Información de WiFi',
    lastUpdated: 'Última Actualización',
    staleTooltip: 'Actualizado hace más de 90 días; los códigos podrían haber cambiado',
  },
  badges: {
    missing: 'Faltante',
    missingTooltip: 'No hay códigos de acceso configurados. Falta: {{fields}}',
    incomplete: 'Incompleto',
    incompleteTooltip: 'Falta: {{fields}}',
  },
  aria: {
    copied: '¡Copiado!',
    copyField: 'Copiar {{field}} al portapapeles',
    hideField: 'Ocultar {{field}}',
    revealField: 'Mostrar {{field}}',
    copyAllCodes: 'Copiar todos los códigos de {{name}}',
  },
  copyAll: {
    propertyLabel: 'Propiedad',
    // REVIEW: "Automático" for the auto/lock code label in the copy-all clipboard blob — matches "Código Automático" used elsewhere on this page.
    autoLabel: 'Automático',
    doorLabel: 'Puerta',
    wifiLabel: 'WiFi',
    otherLabel: 'Otro',
  },
  toasts: {
    saved: 'Guardado',
    updateFailed: 'Error al actualizar',
    csvExported: 'CSV exportado',
    csvExportedDescription: '{{count}} filas exportadas',
  },
}
