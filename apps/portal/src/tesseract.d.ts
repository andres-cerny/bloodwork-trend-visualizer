// The ESM build tesseract.js ships beside its CommonJS entry: one default
// export, the same object `import * as Tesseract from "tesseract.js"` gives.
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  const Tesseract: typeof import("tesseract.js");
  export default Tesseract;
}
