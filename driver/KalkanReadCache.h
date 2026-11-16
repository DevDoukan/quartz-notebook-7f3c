#ifndef KALKAN_READ_CACHE_H
#define KALKAN_READ_CACHE_H
#include "KalkanProtocol.h"
/* Positive whole-file decisions only. Caller holds the stream cache lock;
   the volume read gate must remain held through the real read completion. */
#define KALKAN_READ_CACHE_TTL_100NS 10000000ULL
typedef struct _KALKAN_READ_CACHE {
    unsigned __int64 Generation, Revision, PolicyEpoch, VerifiedAt;
} KALKAN_READ_CACHE;
static __inline int KalkanReadCacheMatches(const KALKAN_READ_CACHE *cache,
    unsigned __int64 generation, unsigned __int64 revision,
    unsigned __int64 policyEpoch, unsigned __int64 now)
{
    return cache && generation && revision && policyEpoch && cache->VerifiedAt &&
        cache->Generation == generation && cache->Revision == revision &&
        cache->PolicyEpoch == policyEpoch && now >= cache->VerifiedAt &&
        now - cache->VerifiedAt < KALKAN_READ_CACHE_TTL_100NS;
}
static __inline void KalkanReadCacheRecord(KALKAN_READ_CACHE *cache,
    unsigned __int64 generation, unsigned __int64 revision,
    unsigned __int64 policyEpoch, unsigned __int64 now,
    long scanStatus, unsigned long decision)
{
    if (!cache) return;
    /* A failed or incomplete scan can never publish an allow entry. */
    *cache = (KALKAN_READ_CACHE){0};
    if (scanStatus != 0 || decision != KALKAN_DECISION_ALLOW ||
        !generation || !revision || !policyEpoch || !now) return;
    cache->Generation = generation; cache->Revision = revision;
    cache->PolicyEpoch = policyEpoch; cache->VerifiedAt = now;
}
#endif
