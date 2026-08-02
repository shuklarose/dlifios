// sources/eurlex.ts - EUR-Lex machine routes.
// Today: SPARQL change detection - "what data-protection acts are new since DATE?"
// Called by the daily monitor run.

import {
  SPARQL_ENDPOINT,
  EUROVOC_DATA_PROTECTION,
  CELLAR_BASE,
  ACCEPT_HTML,
  USER_AGENT,
} from "../config.ts";

// Fetch the full English XHTML of any act by CELEX id (same call probe.ts proved).
export async function fetchCelexHtml(celex: string): Promise<string> {
  const response = await fetch(CELLAR_BASE + celex, {
    headers: {
      Accept: ACCEPT_HTML,
      "Accept-Language": "en",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Cellar fetch failed for ${celex}: ${response.status}`);
  }

  return response.text();
}

// The simplified shape we hand back to callers - they never see raw SPARQL JSON.
export interface NewAct {
  celex: string;
  title: string;
  date: string;
}

function buildQuery(sinceDate: string): string {
  return `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT DISTINCT ?celex ?title ?date WHERE {
  ?work cdm:work_is_about_concept_eurovoc <http://eurovoc.europa.eu/${EUROVOC_DATA_PROTECTION}> .
  ?work cdm:work_date_document ?date .
  ?work cdm:resource_legal_id_celex ?celex .
  ?expr cdm:expression_belongs_to_work ?work .
  ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> .
  ?expr cdm:expression_title ?title .
  FILTER(?date >= "${sinceDate}"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT 25
`;
}

export async function findNewActs(sinceDate: string): Promise<NewAct[]> {
  const response = await fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    body: "query=" + encodeURIComponent(buildQuery(sinceDate)),
  });

  if (!response.ok) {
    throw new Error(`SPARQL failed: ${response.status} - ${(await response.text()).slice(0, 300)}`);
  }

  const json = await response.json();

  return json.results.bindings.map((row: any) => ({
    celex: row.celex.value,
    title: row.title.value,
    date: row.date.value,
  }));
}
