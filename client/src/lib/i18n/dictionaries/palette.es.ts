import type { paletteEn } from './palette.en'

/**
 * Spanish (Latin American) strings for the CommandPalette+CsvImportModal
 * surface (+ the KeyboardShortcuts cheat sheet). Typed as `typeof paletteEn`
 * so TypeScript fails the build if a key is added to one dictionary and not
 * the other.
 */
export const paletteEs: typeof paletteEn = {
  palette: {
    srSearchDescription: 'Busca propiedades o navega a una página',
    placeholder: 'Buscar propiedades o navegar a una página…',
    groups: {
      pages: 'Páginas',
      recentlyViewed: 'Vistos Recientemente',
      properties: 'Propiedades',
      clients: 'Clientes',
    },
    hints: {
      navigate: 'para navegar',
      select: 'para seleccionar',
      close: 'para cerrar',
    },
    pages: {
      liveProForma: 'Pro Forma en Vivo',
    },
  },
  csv: {
    title: 'Importar Historial de Limpiezas',
    steps: {
      upload: 'Subir',
      mapColumns: 'Mapear Columnas',
      matchProperties: 'Coincidir Propiedades',
      summary: 'Resumen',
    },
    upload: {
      dropHint: 'Arrastra un archivo CSV aquí o haz clic para buscar',
      requirements: 'Debe incluir al menos: nombre de propiedad, fecha de limpieza',
    },
    mapping: {
      loadedRows: 'Se cargaron {{count}} filas de {{fileName}}. Mapea las columnas a continuación.',
      propertyName: 'Nombre de la Propiedad *',
      cleanDate: 'Fecha de Limpieza *',
      cleanerName: 'Nombre del Limpiador',
      notMapped: '— sin asignar —',
      previewTitle: 'Vista previa (primeras {{count}} filas)',
    },
    match: {
      matchedCount: '{{count}} coincidencia(s)',
      newCount: '{{count}} propiedad(es) nueva(s)',
      unmatchedCount: '{{count}} sin coincidencia — asigna, crea una nueva o omite',
      errorsHeader: '{{count}} filas omitidas por fechas no válidas:',
      moreErrors: '…y {{count}} más',
      recordsCount: '{{count}} registros',
      newPropertyPlaceholder: 'Ingresa el nombre de la propiedad…',
      cancelNewTooltip: 'Cancelar propiedad nueva',
      skipOption: '— omitir —',
      newPropertyOption: 'Nueva Propiedad',
    },
    summary: {
      willUpdatePrefix: 'Esto actualizará',
      existingNoun: 'propiedad(es) existente(s)',
      andCreatePrefix: 'y creará',
      newNoun: 'propiedad(es) nueva(s)',
      skippedFragment: '({{count}} omitida(s))',
      dateRangeLabel: 'Rango de fechas de limpieza:',
      dateRangeTo: 'a',
      cleansCount: '{{count}} limpiezas',
      perMonthSuffix: '/mes',
      firstLabel: 'primera:',
      explanation: {
        prefix: 'Para cada propiedad se actualizará:',
        firstCleanDate: 'la primera fecha de limpieza',
        cleansPerMonth: 'limpiezas/mes',
        middle: '(exacto según el CSV), y',
        frequency: 'la frecuencia',
        suffix: '.',
        newPropertiesNote: 'Las propiedades nuevas se agregarán como Activas.',
      },
    },
    frequency: {
      weekly: 'semanal',
      biweekly: 'quincenal',
      monthly: 'mensual',
      custom: 'personalizado',
      as_needed: 'según necesidad', // REVIEW: "as needed" — a veces "bajo demanda"
    },
    done: {
      title: 'Importación completa',
      createdOneMessage: 'Se creó {{count}} propiedad nueva:',
      createdManyMessage: 'Se crearon {{count}} propiedades nuevas:',
      footnote: 'Estas propiedades se agregaron con la frecuencia de limpieza inferida de tu CSV. Ábrelas desde Pipeline o Lista de Propiedades para completar el Cobro al Cliente, costos, información del cliente y otros detalles.',
    },
    toast: {
      importedOf: 'Se importaron {{success}} de {{total}} propiedades',
      updatedNoun: '{{count}} propiedad(es) actualizada(s)',
      duplicatesSkipped: '{{count}} duplicado(s) omitido(s)',
      newCleanRecords: '{{count}} nuevos registros de limpieza',
    },
    errors: {
      notCsv: 'Por favor sube un archivo .csv.',
      parseFailedPrefix: 'No se pudo procesar el CSV: {{message}}',
      parseErrorPrefix: 'Error al procesar: {{message}}',
      missingMapping: 'Por favor mapea las columnas de Nombre de Propiedad y Fecha de Limpieza.',
      unparsableDate: 'Fila {{row}}: no se pudo procesar la fecha "{{date}}"',
      noValidRecords: 'No se encontraron registros válidos. Revisa el mapeo de columnas.',
      missingNewNames: 'Por favor ingresa un nombre para {{count}} propiedad(es) nueva(s).',
      noMatchedOrNew: 'No hay propiedades coincidentes o nuevas para importar. Por favor haz coincidir al menos una propiedad.',
      createFailed: 'Error al crear "{{name}}": {{message}}',
      updateFailed: 'Error al actualizar {{name}}: {{message}}',
      unexpectedError: 'Error inesperado en {{name}}: {{message}}',
    },
    buttons: {
      nextMatch: 'Siguiente: Coincidir Propiedades',
      nextSummary: 'Siguiente: Revisar Resumen',
      importing: 'Importando…',
      importCount: 'Importar {{count}} Propiedad(es)',
      done: 'Listo',
    },
  },
  shortcuts: {
    title: 'Atajos de Teclado',
    then: 'luego',
    sections: {
      navigation: {
        title: 'Navegación (G + tecla)',
        items: {
          dashboard: 'Dashboard', // REVIEW: "Dashboard" se mantiene sin traducir, igual que common.nav.dashboard
          pipeline: 'Pipeline', // REVIEW: se mantiene sin traducir, igual que common.nav.pipeline
          clients: 'Clientes',
          quoteSheet: 'Hoja de Cotización',
          costTracking: 'Seguimiento de Costos',
          propertyList: 'Lista de Propiedades',
          linenRequirements: 'Requisitos de Ropa de Cama',
          acFilters: 'Filtros de A/C',
          masterList: 'Lista Maestra',
          revenueReport: 'Reporte de Ingresos',
          inspections: 'Inspecciones',
          settings: 'Configuración',
        },
      },
      actions: {
        title: 'Acciones',
        items: {
          newItem: 'Nuevo elemento (depende del contexto)',
          openShortcuts: 'Abrir atajos de teclado',
          closeModal: 'Cerrar modal/diálogo',
        },
      },
      global: {
        title: 'Global',
        items: {
          searchPalette: 'Buscar / Paleta de Comandos',
        },
      },
    },
  },
}
