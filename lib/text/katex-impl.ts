// The eager half of the lazy KaTeX split — reached ONLY through the dynamic
// `import()` in katex-lazy.ts, never by a static import. Keeping the library
// and its stylesheet behind that boundary is the whole point: anything that
// statically imports this file puts ~840 KB of JS plus 24 KB of
// render-blocking CSS straight back into /notebook's first load.

import katex from 'katex'
import 'katex/dist/katex.min.css'

export default katex
