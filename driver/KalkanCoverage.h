#ifndef KALKAN_COVERAGE_H
#define KALKAN_COVERAGE_H
#include "KalkanProtocol.h"
/* Transport coverage only. Parser completion is a separate mandatory input;
   per-chunk clean answers cannot prove a document is clean. */
typedef struct _KALKAN_COVERAGE {
    KALKAN_SCAN_REQUEST Identity;
    unsigned __int64 NextOffset;
    unsigned __int64 LastRequestId;
    int Started;
    int Invalid;
    int Blocked;
    int Complete;
} KALKAN_COVERAGE;
static __inline int KalkanSameStream(const KALKAN_SCAN_REQUEST *a, const KALKAN_SCAN_REQUEST *b)
{
    unsigned long i;
    if (a->PolicyRevision != b->PolicyRevision || a->ContentGeneration != b->ContentGeneration ||
        a->VolumeSerial != b->VolumeSerial || a->FileSize != b->FileSize) return 0;
    for (i = 0; i < sizeof(a->FileId); ++i) if (a->FileId[i] != b->FileId[i]) return 0;
    return 1;
}
static __inline int KalkanCoverChunk(KALKAN_COVERAGE *state, const KALKAN_SCAN_REQUEST *request,
    unsigned long received, unsigned long decision, int parserComplete)
{
    if (state == 0) return 0;
    if (state->Invalid || state->Complete || !KalkanValidScanRequest(request, received) ||
        (decision != KALKAN_DECISION_ALLOW && decision != KALKAN_DECISION_BLOCK) ||
        (parserComplete != 0 && parserComplete != 1)) { state->Invalid = 1; return 0; }
    if (!state->Started) { state->Identity = *request; state->Started = 1; }
    if (!KalkanSameStream(&state->Identity, request) || request->Offset != state->NextOffset ||
        request->RequestId <= state->LastRequestId ||
        (request->ContentLength == 0 && request->FileSize != 0)) { state->Invalid = 1; return 0; }
    state->NextOffset += request->ContentLength;
    state->LastRequestId = request->RequestId;
    if (decision == KALKAN_DECISION_BLOCK) state->Blocked = 1;
    if (parserComplete) {
        if (state->NextOffset != request->FileSize) { state->Invalid = 1; return 0; }
        state->Complete = 1;
    }
    return 1;
}
static __inline int KalkanCoverageAllows(const KALKAN_COVERAGE *state)
{
    return state != 0 && state->Started && state->Complete && !state->Invalid && !state->Blocked &&
        state->NextOffset == state->Identity.FileSize;
}
/* No cryptographic signature is implied here: this validates the reply from
   the authenticated local port. Signed policy verification remains separate. */
static __inline int KalkanCoverReply(KALKAN_COVERAGE *state,
    const KALKAN_SCAN_REQUEST *request, unsigned long requestBytes,
    const KALKAN_SCAN_RESULT *reply, unsigned long replyBytes,
    long transportStatus, int deadlineExpired)
{
    if (state == 0) return 0;
    if (!KalkanValidScanRequest(request, requestBytes) ||
        !KalkanValidScanResult(reply, replyBytes, transportStatus, deadlineExpired,
            request->RequestId, request->PolicyRevision, request->ContentGeneration)) {
        state->Invalid = 1;
        return 0;
    }
    return KalkanCoverChunk(state, request, requestBytes, reply->Decision,
        (reply->Flags & KALKAN_RESULT_PARSER_COMPLETE) != 0);
}
#endif
