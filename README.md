# Retrieval

An interactive monograph on retrieval-augmented generation. A single long-form page that develops the subject from the embedding space through HNSW indexing to the full RAG pipeline, with seven live figures and a literature review.

**Live:** https://pablowilliams.github.io/Retrieval/

## What is here

Ten sections on one continuous-scroll page:

1. Augmenting generation with retrieval — why and what is gained
2. Embeddings and the embedding space — dense vectors as the unit of retrieval
3. **A history of retrieval-augmented generation: a literature review** — Salton's vector space, BM25, Word2vec, BERT, Sentence-BERT, DPR, ColBERT, HNSW, RAG, REALM, RETRO; each method traced to the failure of its predecessor
4. Similarity: cosine, dot product, Euclidean
5. Chunking the document
6. Approximate nearest-neighbour search — IVF, product quantisation, HNSW
7. Rerankers and cross-encoders
8. Hybrid search: sparse and dense together
9. The full pipeline
10. Conclusion and limits

Seven interactive figures run real information-retrieval algorithms on synthetic data. Twelve references.

## Accessibility

Built to WCAG 2.2 AA, with an accessibility pattern set reviewed ahead of writing the code.

- Each figure is a `<canvas role="img">` with a stable accessible name and a description that updates as the reader interacts; one `role="status"` region per figure announces results, debounced.
- Movable elements are operated with the arrow keys (Shift for coarse steps); a single click or tap places them (WCAG 2.2 SC 2.5.7).
- The query point is rendered as a diamond and the metric-disagreement marks as a diamond and a square, so distinctions never depend on colour alone.
- Sliders are native `<input type="range">` with labels, visible `<output>` values and `aria-valuetext`; metric, strategy and trace controls are keyboard-operated radio groups with roving tabindex.
- All text meets 4.5:1 contrast; canvas marks, controls and focus indicators meet 3:1. Light and dark themes are both verified.
- The reading-progress bar is decorative and marked `aria-hidden`; `prefers-reduced-motion` is honoured in CSS and JavaScript.

## Stack

Vanilla HTML, CSS and JavaScript. No build step, no frameworks, no dependencies.

## Run locally

```bash
git clone https://github.com/pablowilliams/Retrieval.git
cd Retrieval
open index.html
```

## Sources

The literature review cites twelve works; full bibliographic details are in the References section of the page. The principal sources are Salton, Wong and Yang (1975), Spärck Jones (1972), Robertson and Spärck Jones (1976), Mikolov et al. (2013), Devlin et al. (2019), Reimers and Gurevych (2019), Karpukhin et al. (2020), Khattab and Zaharia (2020), Malkov and Yashunin (2018), and Lewis et al. (2020).
