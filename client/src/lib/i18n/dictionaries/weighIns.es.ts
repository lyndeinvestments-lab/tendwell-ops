import type { weighInsEn } from './weighIns.en'

/**
 * Spanish (Latin American) strings for the laundry-weigh-in+laundry-weigh-ins
 * surface. `laundry_type` DB values ('clean'/'dirty') stay canonical English
 * — `list.filters.clean/dirty` and `form.type.clean/dirty` below are
 * display-only labels.
 */
export const weighInsEs: typeof weighInsEn = {
  form: {
    title: 'Pesaje Diario de Lavandería',
    subtitle: 'Registra las bolsas de ropa que estás llevando o dejando.',
    name: {
      label: 'Tu Nombre',
      placeholder: 'Nombre y apellido',
    },
    photo: {
      label: 'Foto',
      take: 'Tomar Foto',
      retake: 'Tomar de Nuevo',
      remove: 'Quitar',
      hint: 'Toca para tomar una foto de la(s) bolsa(s) de ropa.',
      previewAlt: 'Vista previa de la lavandería',
    },
    pounds: {
      label: 'Libras de Ropa',
      placeholder: 'ej. 25',
      unit: 'lbs',
    },
    type: {
      label: 'Tipo de Ropa',
      clean: 'Limpia (entrega)',
      dirty: 'Sucia (recogida)',
    },
    specialLinens: {
      label: '¿Ropa Especial?',
      hint: 'Artículos que requieren atención o cuidado especial.',
      yes: 'Sí',
      no: 'No',
      propertyLabel: 'Propiedad',
      propertyPlaceholder: 'Buscar propiedad…',
      noPropertiesFound: 'No se encontraron propiedades',
      descLabel: 'Descripción de Ropa Especial',
      descPlaceholder: 'ej. Edredón king, cortinas delicadas…',
      photoLabel: 'Foto de Ropa Especial',
      photoTake: 'Tomar Foto',
      photoRetake: 'Tomar de Nuevo',
      photoHint: 'Toca para tomar una foto del artículo especial.',
      photoPreviewAlt: 'Vista previa de la ropa especial',
      weightLabel: 'Peso de Ropa Especial',
      weightPlaceholder: 'ej. 5',
    },
    submit: 'Enviar Pesaje',
    submitting: 'Enviando…',
    submitAnother: 'Enviar Otro',
    footer: 'Tendwell Cleaning Co.',
  },
  validation: {
    required: 'Por favor completa tu nombre, libras y tipo de ropa.',
    pounds: 'Las libras deben ser un número mayor que cero.',
    specialLinens: 'Por favor completa la propiedad, descripción y peso de la ropa especial.',
    specialWeight: 'El peso de la ropa especial debe ser un número mayor que cero.',
    photo: 'No se pudo subir la foto. Inténtalo de nuevo.',
    generic: 'Algo salió mal. Inténtalo de nuevo.',
  },
  success: {
    title: 'Pesaje Enviado',
    body: 'Gracias. Tu pesaje de ropa ha sido registrado.',
  },
  list: {
    page: {
      title: 'Pesajes de Lavandería',
      subtitle: 'Envíos diarios del personal de limpieza desde el formulario público',
    },
    actions: {
      openForm: 'Abrir formulario',
      copyLink: 'Copiar enlace',
      copied: 'Copiado',
    },
    toasts: {
      linkCopiedTitle: 'Enlace copiado',
      copyFailedTitle: 'Error al copiar',
      copyFailedDescription: 'Selecciona y copia manualmente.',
      deletedTitle: 'Pesaje eliminado',
      deleteFailedTitle: 'No se pudo eliminar',
      exportedTitle: 'Exportado',
      exportedDescription: '{{count}} filas descargadas.',
    },
    stats: {
      submissions: 'Envíos',
      cleanLbs: 'Libras limpias',
      dirtyLbs: 'Libras sucias',
      uniqueCleaners: 'Limpiadores únicos', // REVIEW: matches issues.es.ts "Limpiador"; common.es.ts nav uses "Personal de Limpieza" instead — pick one team-wide
    },
    filters: {
      searchPlaceholder: 'Buscar nombre del limpiador…', // REVIEW: see uniqueCleaners note above
      allTypes: 'Todos los tipos',
      clean: 'Limpia',
      dirty: 'Sucia',
      last7Days: 'Últimos 7 días',
      last30Days: 'Últimos 30 días',
      last90Days: 'Últimos 90 días',
      allTime: 'Todo el tiempo',
    },
    table: {
      submitted: 'Enviado',
      cleaner: 'Limpiador', // REVIEW: see uniqueCleaners note above
      type: 'Tipo',
      pounds: 'Libras',
      photo: 'Foto',
      none: 'Ninguna',
      viewPhotoAria: 'Ver foto',
      photoAlt: 'Foto de pesaje',
      deleteAria: 'Eliminar pesaje',
      deleteConfirm: '¿Eliminar el pesaje de {{name}}?',
      openOriginal: 'Abrir original',
      showing: 'Mostrando {{first}}-{{last}} de {{total}}',
      previous: 'Anterior',
      next: 'Siguiente',
      pageOf: 'Página {{page}} de {{total}}',
    },
    empty: {
      title: 'Aún no hay pesajes',
      description: 'Los envíos del formulario público aparecerán aquí.',
    },
    errorTitle: 'No se pudieron cargar los pesajes',
  },
}
