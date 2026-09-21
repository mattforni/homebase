#!/usr/bin/env node
/*
 * Parity between two rendered emails.
 *
 *   node runners/email/parity.mjs <a.html> <b.html>
 *
 * Byte equality with jq is impossible and is not the bar. React writes
 * `&#x27;` where jq writes `&#39;`, `<br/>` where jq writes `<br>`, and an
 * explicit `<tbody>` where jq leaves the parser to insert one. The bar is the
 * parsed document, so both files go through the same parser and come out as
 * the same canonical tree.
 *
 * Canonicalization, the same rules as the reference normalizer in the ui
 * repo's tst/email/normalize.ts, on a light parser rather than a whole DOM:
 * element and attribute names lowercase, attributes sorted by name, `style` an
 * ORDERED list of `prop:value` declarations with whitespace trimmed, empty
 * declarations and the trailing semicolon dropped and hex colors lowercased,
 * an attribute free implied `<tbody>` spliced away, adjacent text merged and
 * compared exactly, and character references left to the parser.
 *
 * Exit 0 only when the two are equal; otherwise the first difference and its
 * path go to stdout and the exit status is 1.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";

function canonStyle(value) {
	return value
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => declaration !== "")
		.map((declaration) => {
			const colon = declaration.indexOf(":");
			if (colon < 0) return declaration.toLowerCase();
			const prop = declaration.slice(0, colon).trim().toLowerCase();
			const val = declaration
				.slice(colon + 1)
				.trim()
				.replace(/#[0-9a-fA-F]{3,8}/g, (hex) => hex.toLowerCase());
			return `${prop}:${val}`;
		});
}

function canonAttrs(node) {
	return (node.attrs ?? [])
		.map((attr) => {
			const name = attr.name.toLowerCase();
			return [name, name === "style" ? canonStyle(attr.value) : attr.value];
		})
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function push(out, node) {
	const last = out[out.length - 1];
	if (typeof node === "string" && typeof last === "string") out[out.length - 1] = last + node;
	else out.push(node);
}

function canonNodes(nodes) {
	const out = [];
	for (const node of nodes ?? []) {
		if (node.nodeName === "#text") {
			push(out, node.value ?? "");
			continue;
		}
		if (node.nodeName === "#comment" || node.nodeName === "#documentType") continue;
		const tag = node.tagName.toLowerCase();
		const children = canonNodes(node.childNodes);
		if (tag === "tbody" && (node.attrs ?? []).length === 0) {
			for (const child of children) push(out, child);
			continue;
		}
		out.push({ tag, attrs: canonAttrs(node), children });
	}
	return out.filter((node) => node !== "");
}

/** A whole html document as its canonical tree, the doctype dropped. */
export function canonicalize(html) {
	const document = parse(html);
	const root = (document.childNodes ?? []).filter(
		(node) => node.nodeName !== "#documentType" && node.nodeName !== "#comment",
	);
	return canonNodes(root);
}

function show(value) {
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return JSON.stringify(value);
	return `<${value.tag} ${JSON.stringify(Object.fromEntries(value.attrs))}>`;
}

/** The first place two canonical trees disagree, with the path to it, or null. */
export function firstDifference(left, right, path = "") {
	const count = Math.max(left.length, right.length);
	for (let index = 0; index < count; index += 1) {
		const here = `${path}[${index}]`;
		const a = left[index];
		const b = right[index];
		if (a === undefined) return `${here}: only the second document has ${show(b)}`;
		if (b === undefined) return `${here}: only the first document has ${show(a)}`;
		if (typeof a === "string" || typeof b === "string") {
			if (a !== b) return `${here}: text ${show(a)} vs ${show(b)}`;
			continue;
		}
		const where = `${path}[${index}] ${a.tag}`;
		if (a.tag !== b.tag) return `${here}: tag <${a.tag}> vs <${b.tag}>`;
		const names = [...new Set([...a.attrs.map((x) => x[0]), ...b.attrs.map((x) => x[0])])].sort();
		for (const name of names) {
			const av = a.attrs.find((x) => x[0] === name);
			const bv = b.attrs.find((x) => x[0] === name);
			if (av === undefined) return `${where}: only the second document sets ${name}`;
			if (bv === undefined) return `${where}: only the first document sets ${name}`;
			if (JSON.stringify(av[1]) !== JSON.stringify(bv[1])) {
				return `${where}: ${name} ${show(av[1])} vs ${show(bv[1])}`;
			}
		}
		const deeper = firstDifference(a.children, b.children, `${where} > `);
		if (deeper !== null) return deeper;
	}
	return null;
}

/** True when two rendered documents parse to the same canonical tree. */
export function equalDocuments(left, right) {
	return firstDifference(canonicalize(left), canonicalize(right)) === null;
}

function main(argv) {
	if (argv.length !== 2) {
		process.stderr.write("usage: parity.mjs <a.html> <b.html>\n");
		return 2;
	}
	const [left, right] = argv.map((file) => readFileSync(file, "utf8"));
	const difference = firstDifference(canonicalize(left), canonicalize(right));
	if (difference === null) {
		process.stdout.write(`parity: ${argv[0]} and ${argv[1]} are the same document\n`);
		return 0;
	}
	process.stdout.write(`parity: ${difference}\n`);
	return 1;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
	process.exit(main(process.argv.slice(2)));
}
