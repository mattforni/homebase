/** What every page is handed beside its draft: the week it covers and the run's one line of facts. */
export type RenderContext = {
	/** The ISO week, "2026-W38". */
	week: string;
	/** The week's Monday, "2026-09-14". */
	monday: string;
	/** The week's Sunday, "2026-09-20". */
	sunday: string;
	/** The footer line: duration, cost, turns, models. */
	meta: string;
};

/** A page: the html document, or its plain text alternative part. */
export type Page = {
	html: (draft: unknown, context: RenderContext) => string;
	text: (draft: unknown, context: RenderContext) => string;
};
