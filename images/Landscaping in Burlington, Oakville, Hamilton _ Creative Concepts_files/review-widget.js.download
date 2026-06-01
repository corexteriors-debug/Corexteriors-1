window.addEventListener(
  'message',
  function (e) {
    let eventName = e.data[0]
    let data = e.data[1]

    const reviewIframes = Array.from(
      document.querySelectorAll(
        '.lc_reviews_widget, #msgsndr_reviews, #highlevel_reviews',
      ),
    )

    let selectedIframes =
      reviewIframes.filter(
        (iframe) =>
          new URL(iframe.src)?.searchParams?.get('widgetId') === data?.widgetId,
      ) ?? []

    if (!selectedIframes?.length) {
      selectedIframes =
        reviewIframes.filter(
          (iframe) => !new URL(iframe.src)?.searchParams?.get('widgetId'),
        ) ?? []
    }

    if (!selectedIframes?.length) {
      selectedIframes =
        reviewIframes.filter(
          (iframe) =>
            new URL(iframe.src)?.searchParams?.get('widgetId') ===
            data?.requestedWidgetId,
        ) ?? []
    }

    selectedIframes?.forEach((iframe) => {
      if (eventName === 'lc.setHeight' && data?.id === 'lc_reviews_widget') {
        iframe.style.transition = 'height 0.5s'
        iframe.height = data?.height
      } else if (
        eventName === 'lc.setFlashHeight' &&
        data?.id === 'lc_reviews_widget'
      ) {
        iframe.style.transition = 'height 0.5s'

        iframe.style.width = ''
        iframe.style.minWidth = ''
        iframe.style.bottom = ''
        iframe.style.left = ''
        iframe.style.top = ''
        iframe.style.right = ''
        iframe.style.zIndex = ''
        iframe.style.position = ''

        data?.height && (iframe.height = data?.height)
        data?.width && (iframe.width = data?.width)
        data.zIndex && (iframe.style.zIndex = data.zIndex)
        data.position && (iframe.style.position = data.position)
        data.bottom && (iframe.style.bottom = data.bottom)
        data.left && (iframe.style.left = data.left)
        data.top && (iframe.style.top = data.top)
        data.right && (iframe.style.right = data.right)
      }
    })
  },
  false,
)
