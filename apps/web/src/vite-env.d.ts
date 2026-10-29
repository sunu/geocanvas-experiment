/// <reference types="vite/client" />

/** shpjs ships no types. It reads a zipped shapefile (or a .shp and its siblings) and reprojects it with its .prj. */
declare module 'shpjs' {
  export default function shp(input: string | ArrayBuffer): Promise<GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]>
}
