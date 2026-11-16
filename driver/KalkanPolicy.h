#ifndef KALKAN_POLICY_H
#define KALKAN_POLICY_H
#include "KalkanProtocol.h"
#define KALKAN_POLICY_UPDATE_COMMAND 5u
#define KALKAN_POLICY_QUERY_COMMAND 6u
#define KALKAN_POLICY_READY 1u
#define KALKAN_POLICY_UNAVAILABLE 2u
#define KALKAN_POLICY_FRESHNESS_100NS 50000000ULL
static __inline int KalkanPolicyFresh(unsigned __int64 refreshed, unsigned __int64 now)
{
    return refreshed != 0 && now >= refreshed && now - refreshed < KALKAN_POLICY_FRESHNESS_100NS;
}
typedef struct _KALKAN_POLICY_UPDATE {
    unsigned long Version, Size, Command, Mode;
    unsigned __int64 Revision, Reserved;
} KALKAN_POLICY_UPDATE;
typedef char KALKAN_ASSERT_POLICY_SIZE[(sizeof(KALKAN_POLICY_UPDATE) == 32) ? 1 : -1];
typedef struct _KALKAN_POLICY_STATE {
    unsigned __int64 Revision, Epoch;
    unsigned long Mode;
} KALKAN_POLICY_STATE;
/* Caller serializes access. Only the authenticated service supplies these
   messages, after verifying central policy and Client entitlement. */
static __inline int KalkanApplyPolicy(KALKAN_POLICY_STATE *state,
    const KALKAN_POLICY_UPDATE *value, unsigned long bytes)
{
    if (!state || !value || bytes != sizeof(*value) || value->Size != sizeof(*value) ||
        value->Version != KALKAN_PROTOCOL_VERSION || value->Command != KALKAN_POLICY_UPDATE_COMMAND ||
        value->Reserved || value->Revision > 0x7fffffffffffffffULL ||
        (value->Mode != KALKAN_POLICY_READY && value->Mode != KALKAN_POLICY_UNAVAILABLE) ||
        (value->Mode == KALKAN_POLICY_READY && (!value->Revision || value->Revision < state->Revision))) return 0;
    if (state->Epoch == ~(unsigned __int64)0) { state->Mode = KALKAN_POLICY_UNAVAILABLE; return 0; }
    if (state->Mode == value->Mode && value->Revision <= state->Revision) return 1;
    if (value->Revision > state->Revision) state->Revision = value->Revision;
    state->Mode = value->Mode;
    ++state->Epoch; /* A changed authorization invalidates in-flight decisions. */
    return 1;
}
static __inline int KalkanPolicyMatches(const KALKAN_POLICY_STATE *state,
    unsigned __int64 revision, unsigned __int64 epoch)
{
    return state && state->Mode == KALKAN_POLICY_READY && revision && epoch &&
        state->Revision == revision && state->Epoch == epoch;
}
#endif
