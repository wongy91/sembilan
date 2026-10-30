import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../worker/places.js';

const OUT = fileURLToPath(new URL('../public/data/places/', import.meta.url));
const REGION = { west: 99.5, east: 119.5, south: 0.8, north: 7.5 };
const MIN_CONFIDENCE = 0.5;
const S3 = "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';";

function duckdb(sql) {
  try {
    return execFileSync('duckdb', ['-json', '-c', `${S3} ${sql}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('DuckDB is not installed. Install it with `brew install duckdb` (or see duckdb.org) and run again.');
    throw err;
  }
}

const release =
  process.env.OVERTURE_RELEASE ||
  JSON.parse(duckdb("SELECT max(regexp_extract(file, 'release/([^/]+)/', 1)) AS release FROM glob('s3://overturemaps-us-west-2/release/*/theme=places/type=place/part-00000*');"))[0].release;
console.log(`Overture Maps release ${release}`);

const work = mkdtempSync(join(tmpdir(), 'sembilan-places-'));
const file = join(work, 'places.json');
duckdb(`COPY (
  SELECT names.primary AS name,
         coalesce(addresses[1].locality, '') AS locality,
         coalesce(addresses[1].freeform, '') AS street,
         coalesce(basic_category, '') AS category,
         round((bbox.xmin + bbox.xmax) / 2, 5) AS lon,
         round((bbox.ymin + bbox.ymax) / 2, 5) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning = 1)
  WHERE bbox.xmin BETWEEN ${REGION.west} AND ${REGION.east}
    AND bbox.ymin BETWEEN ${REGION.south} AND ${REGION.north}
    AND names.primary IS NOT NULL
    AND confidence >= ${MIN_CONFIDENCE}
    AND (operating_status IS NULL OR operating_status = 'open')
) TO '${file}' (FORMAT JSON);`);

const places = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
rmSync(work, { recursive: true, force: true });

const { manifest, chunks } = buildIndex(places);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
chunks.forEach((chunk, i) => writeFileSync(join(OUT, `${i}.json`), JSON.stringify(chunk)));
writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify({ source: 'Overture Maps Foundation places', license: 'CDLA-Permissive-2.0', release, built: new Date().toISOString().slice(0, 10), ...manifest }),
);
console.log(`${places.length} places, ${chunks.length} chunks, ${manifest.stop.length} stop words → public/data/places/`);
