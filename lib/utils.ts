import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** tailwind-merge only knows the font sizes Tailwind ships. Our dense-UI scale
 *  (text-ui-xs … text-ui-3xl, defined in globals.css) is invisible to it, so
 *  it filed those classes under text-COLOR — and silently dropped them
 *  whenever a colour class followed:
 *
 *      cn('text-ui-sm', 'text-muted-foreground')  ->  'text-muted-foreground'
 *
 *  which is every conditional row in the sidebar panels. Registering the scale
 *  as font-size makes size and colour independent again, the way text-xs
 *  already behaves. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['ui-3xs', 'ui-2xs', 'ui-xs', 'ui-sm', 'ui-md', 'ui-lg', 'ui-xl', 'ui-2xl', 'ui-3xl'],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
