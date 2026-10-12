import { readFileSync } from 'fs'
import { resolve } from 'path'

/** Carga un fixture HTML y lo devuelve como string. */
export function loadFixture(name: string): string {
  const path = resolve(__dirname, `${name}.html`)
  return readFileSync(path, 'utf-8')
}

/** Carga un fixture HTML y lo parsea a un Document usando DOMParser. */
export function loadFixtureAsDocument(name: string): Document {
  const html = loadFixture(name)
  return new DOMParser().parseFromString(html, 'text/html')
}
