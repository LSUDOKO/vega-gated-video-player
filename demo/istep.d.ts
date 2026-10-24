// esbuild bundles .istep files as JSON (--loader:.istep=json); main.ts validates them with zod at load.
declare module '*.istep' {
  const track: unknown;
  export default track;
}
