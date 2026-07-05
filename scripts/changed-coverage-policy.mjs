export function matchesCriticalModule(file, patterns) {
  return patterns.some((pattern) => new RegExp(pattern).test(file))
}

export function findMissingCoverageFiles(changedFiles, coveredFiles, patterns) {
  return changedFiles
    .filter((file) => matchesCriticalModule(file, patterns))
    .filter((file) => !coveredFiles.has(file))
    .sort()
}
