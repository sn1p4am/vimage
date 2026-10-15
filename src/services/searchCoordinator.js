function createSearchCoordinator({ searchImage, setCachedImage }) {
  const pendingSearches = new Map();

  return async function findImage(description, logData) {
    if (!pendingSearches.has(description)) {
      const searchLog = {};
      const pending = Promise.resolve()
        .then(() => searchImage(description, searchLog))
        .then(result => {
          if (result?.url) {
            setCachedImage(description, result.url);
          }
          return { result, searchLog };
        })
        .finally(() => pendingSearches.delete(description));
      pendingSearches.set(description, pending);
    }

    const { result, searchLog } = await pendingSearches.get(description);
    Object.assign(logData, searchLog);
    return result;
  };
}

module.exports = { createSearchCoordinator };
