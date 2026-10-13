// Bind these callbacks to the user's existing authenticated tools.
// This is an interface template, not a working provider integration.
export function createAdapter({ capabilities, verifyIdentity, callFeishu }) {
  return {
    capabilities, // { tableRead: true, tableWrite: true, messages: false }
    getIdentity: verifyIdentity, // async () => ({ connectionId: stableVerifiedAccountId })
    request: callFeishu, // async (method, path, {params, data}) => ({code: 0, data})
  };
}
