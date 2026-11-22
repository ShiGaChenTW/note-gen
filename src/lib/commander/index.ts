// Fork（almanac ALMNC-54.6）：指揮官分析流程（C0）。純函式與入口；接 App 的預設依賴在 default-deps.ts（需要 Tauri）。
export * from './types'
export { toText, looksLikeRef, readableOriginal, MAX_ANALYSIS_TEXT } from './to-text'
export { splitAndClassify, parseFragments, buildFragmentPrompt, fallbackFragment, MAX_FRAGMENTS } from './split'
export { assign, resolveDomain, expertFor, normalizeDomainName } from './assign'
export { draft, buildDraftPrompt, parseDrafts } from './draft'
export { consolidate, draftToProposal, acceptedOutputLinks, linkAcceptedOutputs, projectTag } from './consolidate'
export { domainProposal, acceptDomainProposal, describeDomainProposal, unassignedKnowledgeNotes, DOMAIN_PROPOSAL_THRESHOLD } from './domain-proposal'
export { analyzeSource, runAnalysisQueue, requeueInterrupted, createAnalysisQueue } from './pipeline'
