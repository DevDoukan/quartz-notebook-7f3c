#include <stdio.h>
#include <string.h>
#include <stddef.h>
#include "KalkanProtocol.h"
#include "KalkanCoverage.h"
#include "KalkanStorage.h"
#include "KalkanPolicy.h"
#include "KalkanIoGate.h"
#include "KalkanScanContext.h"
#include "KalkanCreate.h"
#include "KalkanReadCache.h"
int main(void)
{
    {
        KALKAN_READ_CACHE cache = {0};
        KALKAN_IO_GATE gate = {0};
        KALKAN_POLICY_STATE policy = {0};
        KALKAN_POLICY_UPDATE update = {KALKAN_PROTOCOL_VERSION, sizeof(update), KALKAN_POLICY_UPDATE_COMMAND, KALKAN_POLICY_READY, 5, 0};
        unsigned __int64 generation, epoch;
        long failures[] = {-1, 0x102, 0x103};
        unsigned long i;
        gate.Generation = 1;
        if (KalkanReadCacheMatches(&cache, 1, 5, 1, 100) ||
            KalkanReadCacheMatches(NULL, 1, 5, 1, 100) ||
            !KalkanApplyPolicy(&policy, &update, sizeof(update)) || !KalkanBeginRead(&gate)) return 61;
        generation = KalkanReadGeneration(&gate); epoch = policy.Epoch;
        KalkanReadCacheRecord(&cache, generation, 5, epoch, 100, 0, KALKAN_DECISION_ALLOW);
        if (!KalkanReadCacheMatches(&cache, generation, 5, epoch, 100) ||
            !KalkanReadCacheMatches(&cache, generation, 5, epoch, 100 + KALKAN_READ_CACHE_TTL_100NS - 1) ||
            KalkanReadCacheMatches(&cache, generation, 5, epoch, 100 + KALKAN_READ_CACHE_TTL_100NS) ||
            KalkanReadCacheMatches(&cache, generation, 5, epoch, 99) ||
            KalkanReadCacheMatches(&cache, generation + 1, 5, epoch, 100) ||
            KalkanReadCacheMatches(&cache, generation, 6, epoch, 100) ||
            KalkanReadCacheMatches(&cache, generation, 5, epoch + 1, 100) ||
            KalkanReadCacheMatches(&cache, 0, 5, epoch, 100) ||
            KalkanReadCacheMatches(&cache, generation, 0, epoch, 100) ||
            KalkanReadCacheMatches(&cache, generation, 5, 0, 100)) return 62;
        /* A cache hit must not slide the one-second expiration window. */
        if (cache.VerifiedAt != 100) return 63;
        KalkanEndRead(&gate);
        if (!KalkanBeginMutation(&gate, 0)) return 64;
        KalkanEndMutation(&gate);
        if (!KalkanBeginRead(&gate) || KalkanReadCacheMatches(&cache, KalkanReadGeneration(&gate), 5, epoch, 100)) return 65;
        KalkanEndRead(&gate);
        update.Mode = KALKAN_POLICY_UNAVAILABLE; update.Revision = 0;
        if (!KalkanApplyPolicy(&policy, &update, sizeof(update))) return 66;
        update.Mode = KALKAN_POLICY_READY; update.Revision = 5;
        if (!KalkanApplyPolicy(&policy, &update, sizeof(update)) ||
            KalkanReadCacheMatches(&cache, generation, 5, policy.Epoch, 100)) return 67;
        for (i = 0; i < sizeof(failures) / sizeof(failures[0]); ++i) {
            KalkanReadCacheRecord(&cache, generation, 5, epoch, 100, failures[i], KALKAN_DECISION_ALLOW);
            if (KalkanReadCacheMatches(&cache, generation, 5, epoch, 100)) return 68;
        }
        KalkanReadCacheRecord(&cache, generation, 5, epoch, 100, 0, KALKAN_DECISION_BLOCK);
        if (KalkanReadCacheMatches(&cache, generation, 5, epoch, 100)) return 69;
        KalkanReadCacheRecord(&cache, generation, 5, epoch, 0, 0, KALKAN_DECISION_ALLOW);
        if (KalkanReadCacheMatches(&cache, generation, 5, epoch, 100)) return 70;
        KalkanReadCacheRecord(&cache, generation, 5, epoch, ~(unsigned __int64)0 - 1, 0, KALKAN_DECISION_ALLOW);
        if (KalkanReadCacheMatches(&cache, generation, 5, epoch, 1)) return 71;
        puts("PASS clean-read cache rejects mutations, policy reconnects, time reversal, expiry and failed inspections");
    }
    {
        unsigned long disposition;
        if (KalkanCreateMayMutate(1u << 24, 0xa01200a9u, 0, 0)) return 58;
        for (disposition = 0; disposition < 8; ++disposition)
            if (KalkanCreateMayMutate(disposition << 24, 1, 0, 0) != (disposition != 1)) return 59;
        if (!KalkanCreateMayMutate((1u << 24) | 0x1000u, 1, 0, 0) ||
            !KalkanCreateMayMutate(1u << 24, 2, 0, 0) ||
            !KalkanCreateMayMutate(1u << 24, 0x10000u, 0, 0) ||
            !KalkanCreateMayMutate(1u << 24, 0x40000000u, 0, 0) ||
            !KalkanCreateMayMutate(1u << 24, 1, 1, 0) ||
            !KalkanCreateMayMutate(1u << 24, 1, 0, 1)) return 60;
        puts("PASS readonly existing opens remain distinct from create, overwrite, delete and write access");
    }
    {
        KALKAN_SCAN_REQUEST request = {0};
        request.Version = KALKAN_PROTOCOL_VERSION; request.Size = sizeof(request) + 1;
        request.Command = KALKAN_SCAN_REQUEST_COMMAND; request.ContentLength = 1;
        request.RequestId = request.PolicyRevision = request.ContentGeneration = 1;
        request.FileId[0] = 1; request.FileSize = KALKAN_MAX_SCAN_FILE;
        if (!KalkanValidScanRequest(&request, request.Size)) return 56;
        request.FileSize++;
        if (KalkanValidScanRequest(&request, request.Size)) return 57;
        puts("PASS native file size bound matches the 10 MiB content reader limit");
    }
    if (KalkanPolicyFresh(0, 100) || KalkanPolicyFresh(100, 99) ||
        !KalkanPolicyFresh(100, 100) ||
        !KalkanPolicyFresh(100, 100 + KALKAN_POLICY_FRESHNESS_100NS - 1) ||
        KalkanPolicyFresh(100, 100 + KALKAN_POLICY_FRESHNESS_100NS) ||
        KalkanPolicyFresh(~(unsigned __int64)0 - 1, 1)) return 55;
    puts("PASS stale policy heartbeat and reversed clocks cannot authorize scans");
    {
        unsigned long irql;
        int apcs, recursive, paging;
        for (irql = 0; irql < 4; ++irql)
            for (apcs = 0; apcs < 2; ++apcs)
                for (recursive = 0; recursive < 2; ++recursive)
                    for (paging = 0; paging < 2; ++paging)
                        if (KalkanCanScanContext(irql, apcs, recursive, paging) !=
                            (irql == 0 && apcs == 0 && recursive == 0 && paging == 0)) return 54;
        puts("PASS paging, recursive, elevated and APC-disabled paths cannot enter synchronous scanning");
    }
    {
        KALKAN_IO_GATE gate = {0};
        KALKAN_IO_GATE other = {0};
        unsigned __int64 generation;
        gate.Generation = other.Generation = 1;
        if (!KalkanBeginRead(&gate) || KalkanBeginMutation(&gate, 0) || !KalkanBeginRead(&gate)) return 45;
        generation = KalkanReadGeneration(&gate);
        if (!generation || !KalkanBeginMutation(&other, 0) || KalkanReadGeneration(&gate) != generation) return 51;
        KalkanEndMutation(&other);
        if (KalkanReadGeneration(&gate) != generation) return 52;
        KalkanEndRead(&gate);
        if (KalkanBeginMutation(&gate, 0)) return 46;
        KalkanEndRead(&gate);
        if (!KalkanBeginMutation(&gate, 0) || KalkanBeginRead(&gate)) return 47;
        KalkanEndMutation(&gate);
        if (!KalkanBeginMutation(&gate, 1)) return 48;
        KalkanEndMutation(&gate);
        if (KalkanBeginRead(&gate)) return 49;
        gate = (KALKAN_IO_GATE){0}; gate.Generation = 1; KalkanEndRead(&gate);
        if (KalkanBeginRead(&gate) || KalkanBeginMutation(&gate, 0)) return 50;
        gate = (KALKAN_IO_GATE){0}; gate.Generation = ~(unsigned __int64)0;
        if (KalkanBeginMutation(&gate, 0) || !gate.Invalid || KalkanBeginRead(&gate)) return 53;
        puts("PASS instance generation ignores unrelated volumes and rejects counter exhaustion");
        puts("PASS read lifetime excludes mutations and prior writable mappings prevent clean reads");
    }
    {
        KALKAN_POLICY_STATE state = {0};
        KALKAN_POLICY_UPDATE update = {KALKAN_PROTOCOL_VERSION, sizeof(update), KALKAN_POLICY_UPDATE_COMMAND, KALKAN_POLICY_READY, 5, 0};
        unsigned __int64 epoch;
        if (KalkanPolicyMatches(&state, 5, 1) || !KalkanApplyPolicy(&state, &update, sizeof(update))) return 38;
        epoch = state.Epoch;
        if (!KalkanPolicyMatches(&state, 5, epoch)) return 39;
        if (!KalkanApplyPolicy(&state, &update, sizeof(update)) || state.Epoch != epoch) return 44;
        update.Revision = 4;
        if (KalkanApplyPolicy(&state, &update, sizeof(update)) || !KalkanPolicyMatches(&state, 5, epoch)) return 40;
        update.Mode = KALKAN_POLICY_UNAVAILABLE; update.Revision = 0;
        if (!KalkanApplyPolicy(&state, &update, sizeof(update)) || state.Revision != 5 || KalkanPolicyMatches(&state, 5, state.Epoch)) return 41;
        update.Mode = KALKAN_POLICY_READY; update.Revision = 5;
        if (!KalkanApplyPolicy(&state, &update, sizeof(update)) || KalkanPolicyMatches(&state, 5, epoch)) return 42;
        update.Reserved = 1;
        if (KalkanApplyPolicy(&state, &update, sizeof(update))) return 43;
        puts("PASS policy rollback, disconnect and reauthorization invalidate stale scan decisions");
    }
    if (KalkanClassifyVolume(0,8,7,0) != KALKAN_STORAGE_LOCAL_DISK ||
        KalkanClassifyVolume(0,8,8,0x40001) != KALKAN_STORAGE_PORTABLE ||
        KalkanClassifyVolume(0,8,7,1) != KALKAN_STORAGE_REMOVABLE_MEDIA ||
        KalkanClassifyVolume(0,8,7,0x40010) != KALKAN_STORAGE_REMOTE ||
        KalkanClassifyVolume(0,8,7,0x80000) != KALKAN_STORAGE_REMOTE ||
        KalkanClassifyVolume(0,8,20,0) != KALKAN_STORAGE_UNKNOWN ||
        KalkanClassifyVolume(0,7,7,0) != KALKAN_STORAGE_UNKNOWN ||
        KalkanClassifyVolume(0x102,8,7,0) != KALKAN_STORAGE_UNKNOWN) return 37;
    puts("PASS volume evidence distinguishes portable, removable media, remote and unknown");
    if (KalkanScanBudgetRemaining(100, 100) != KALKAN_SCAN_BUDGET_100NS ||
        KalkanScanBudgetRemaining(100, 101) != KALKAN_SCAN_BUDGET_100NS - 1 ||
        KalkanScanBudgetRemaining(100, 100 + KALKAN_SCAN_BUDGET_100NS - 1) != 1 ||
        KalkanScanBudgetRemaining(100, 100 + KALKAN_SCAN_BUDGET_100NS) != 0 ||
        KalkanScanBudgetRemaining(100, 99) != 0 ||
        KalkanScanBudgetRemaining(~(unsigned __int64)0 - 10, 5) != 0) return 33;
    KALKAN_HELLO_MESSAGE valid = { KALKAN_PROTOCOL_VERSION, sizeof(valid), KALKAN_HELLO, 0 };
    unsigned long length, byte, bit;
    if (KalkanScanDeadlineExpired(100, 100) ||
        KalkanScanDeadlineExpired(100, 100 + KALKAN_SCAN_BUDGET_100NS - 1) ||
        !KalkanScanDeadlineExpired(100, 100 + KALKAN_SCAN_BUDGET_100NS) ||
        !KalkanScanDeadlineExpired(100, 99) ||
        !KalkanScanDeadlineExpired(~(unsigned __int64)0 - 10, 5)) return 32;
    puts("PASS monotonic scan deadline boundaries and counter reversal");
    if (!KalkanValidHello(&valid, sizeof(valid)) || KalkanValidHello(NULL, sizeof(valid))) return 1;
    for (length = 0; length <= 64; ++length) {
        if (KalkanValidHello(&valid, length) != (length == sizeof(valid))) return 2;
    }
    for (byte = 0; byte < sizeof(valid); ++byte) for (bit = 0; bit < 8; ++bit) {
        KALKAN_HELLO_MESSAGE changed = valid;
        ((unsigned char *)&changed)[byte] ^= (unsigned char)(1u << bit);
        if (KalkanValidHello(&changed, sizeof(changed))) return 3;
    }
    puts("PASS HELLO, null, lengths 0..64 and 128 single-bit corruptions");
    {
        KALKAN_STATUS_RESULT status = { KALKAN_PROTOCOL_VERSION, sizeof(status), KALKAN_QUERY_STATUS, 0, 1, 0, 0 };
        if (!KalkanValidStatus(&status, sizeof(status))) return 9;
        status.ProtectionActive = 1;
        if (KalkanValidStatus(&status, sizeof(status))) return 10;
        status.ProtectionActive = 0; status.ActiveMutations = -1;
        if (KalkanValidStatus(&status, sizeof(status))) return 11;
        status.ActiveMutations = 0; status.WritableSectionsSeen = 2;
        if (KalkanValidStatus(&status, sizeof(status))) return 12;
        puts("PASS status contract rejects unsupported protection and invalid counters");
    }
    {
        KALKAN_SCAN_RESULT result = { KALKAN_PROTOCOL_VERSION, sizeof(result), KALKAN_SCAN_REPLY,
            KALKAN_DECISION_ALLOW, 7, 11, 19, 0 };
        if (!KalkanValidScanResult(&result, sizeof(result), 0, 0, 7, 11, 19)) return 4;
        result.Decision = KALKAN_DECISION_BLOCK;
        if (!KalkanValidScanResult(&result, sizeof(result), 0, 0, 7, 11, 19)) return 5;
        result.Decision = KALKAN_DECISION_ALLOW;
        if (KalkanValidScanResult(&result, sizeof(result), 0x102, 0, 7, 11, 19) ||
            KalkanValidScanResult(&result, sizeof(result), 0, 1, 7, 11, 19) ||
            KalkanValidScanResult(&result, sizeof(result), 0, 0, 8, 11, 19) ||
            KalkanValidScanResult(&result, sizeof(result), 0, 0, 7, 12, 19) ||
            KalkanValidScanResult(&result, sizeof(result), 0, 0, 7, 11, 20) ||
            KalkanValidScanResult(NULL, sizeof(result), 0, 0, 7, 11, 19)) return 6;
        for (length = 0; length <= 96; ++length)
            if (KalkanValidScanResult(&result, length, 0, 0, 7, 11, 19) != (length == sizeof(result))) return 7;
        for (byte = 0; byte < sizeof(result); ++byte) for (bit = 0; bit < 8; ++bit) {
            KALKAN_SCAN_RESULT changed = result;
            ((unsigned char *)&changed)[byte] ^= (unsigned char)(1u << bit);
            if (KalkanValidScanResult(&changed, sizeof(changed), 0, 0, 7, 11, 19) !=
                (byte == offsetof(KALKAN_SCAN_RESULT, Flags) && bit == 0)) return 8;
        }
        puts("PASS scan result identity, revision, generation, timeout and 384 corruptions");
        {
            unsigned long random = 0x4b414c4bu, iteration;
            for (iteration = 0; iteration < 100000; ++iteration) {
                KALKAN_SCAN_RESULT changed = result;
                unsigned char *bytes = (unsigned char *)&changed;
                for (byte = 0; byte < sizeof(changed); ++byte) {
                    random ^= random << 13; random ^= random >> 17; random ^= random << 5;
                    bytes[byte] = (unsigned char)random;
                }
                /* Force an invalid protocol version independently of PRNG output. */
                changed.Version = 0;
                if (KalkanValidScanResult(&changed, sizeof(changed), 0, 0, 7, 11, 19)) return 13;
            }
            if (KalkanValidScanResult(&result, sizeof(result), 1, 0, 7, 11, 19) ||
                KalkanValidScanResult(&result, sizeof(result), (long)0xc0000037u, 0, 7, 11, 19)) return 14;
            puts("PASS 100000 malformed bodies and raw nonzero NTSTATUS rejection");
        }
    }
    {
        KALKAN_SCAN_REQUEST request = {0};
        request.Version = KALKAN_PROTOCOL_VERSION; request.Command = KALKAN_SCAN_REQUEST_COMMAND;
        request.RequestId = 1; request.PolicyRevision = 1; request.ContentGeneration = 1;
        request.FileId[0] = 1; request.Size = sizeof(request);
        if (!KalkanValidScanRequest(&request, sizeof(request))) return 15;
        request.ContentLength = KALKAN_MAX_SCAN_CHUNK; request.FileSize = KALKAN_MAX_SCAN_CHUNK;
        request.Size = sizeof(request) + request.ContentLength;
        if (!KalkanValidScanRequest(&request, request.Size)) return 16;
        request.Offset = 1;
        if (KalkanValidScanRequest(&request, request.Size)) return 17;
        request.Offset = ~(unsigned __int64)0; request.FileSize = request.Offset;
        if (KalkanValidScanRequest(&request, request.Size)) return 18;
        request.Offset = 0; request.ContentLength++; request.FileSize = request.ContentLength; request.Size++;
        if (KalkanValidScanRequest(&request, request.Size)) return 19;
        request.ContentLength = 0; request.Size = sizeof(request); request.FileId[0] = 0;
        if (KalkanValidScanRequest(&request, request.Size) || KalkanValidScanRequest(NULL, 0)) return 20;
        puts("PASS scan request identity, empty file, chunk limit and range overflow checks");
    }
    {
        KALKAN_COVERAGE state = {0}, changed;
        KALKAN_SCAN_REQUEST request = {0};
        request.Version = KALKAN_PROTOCOL_VERSION; request.Command = KALKAN_SCAN_REQUEST_COMMAND;
        request.RequestId = 1; request.PolicyRevision = 1; request.ContentGeneration = 1;
        request.FileId[0] = 1; request.FileSize = 8; request.ContentLength = 4;
        request.Size = sizeof(request) + 4;
        if (!KalkanCoverChunk(&state, &request, request.Size, KALKAN_DECISION_ALLOW, 0) || KalkanCoverageAllows(&state)) return 21;
        changed = state;
        if (KalkanCoverChunk(&changed, &request, request.Size, KALKAN_DECISION_ALLOW, 1)) return 22;
        request.Offset = 4; request.RequestId = 2;
        changed = state; request.RequestId = 1;
        if (KalkanCoverChunk(&changed, &request, request.Size, KALKAN_DECISION_ALLOW, 1) || !changed.Invalid) return 31;
        request.RequestId = 2;
        changed = state; request.ContentGeneration++;
        if (KalkanCoverChunk(&changed, &request, request.Size, KALKAN_DECISION_ALLOW, 1)) return 23;
        request.ContentGeneration--;
        changed = state;
        if (!KalkanCoverChunk(&changed, &request, request.Size, KALKAN_DECISION_BLOCK, 1) || KalkanCoverageAllows(&changed)) return 24;
        if (!KalkanCoverChunk(&state, &request, request.Size, KALKAN_DECISION_ALLOW, 1) || !KalkanCoverageAllows(&state)) return 25;
        if (KalkanCoverChunk(&state, &request, request.Size, KALKAN_DECISION_ALLOW, 1) || KalkanCoverageAllows(&state)) return 26;
        puts("PASS partial, replayed, changed and blocked coverage cannot allow a file");
        {
            KALKAN_SCAN_RESULT reply = { KALKAN_PROTOCOL_VERSION, sizeof(reply), KALKAN_SCAN_REPLY,
                KALKAN_DECISION_ALLOW, 5, 1, 1, KALKAN_RESULT_PARSER_COMPLETE };
            KALKAN_COVERAGE fresh = {0}, failed;
            request.Offset = 0; request.ContentLength = 8; request.Size = sizeof(request) + 8;
            request.RequestId = 5;
            failed = fresh;
            if (KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0x102, 0) ||
                KalkanCoverageAllows(&failed) || !failed.Invalid) return 27;
            failed = fresh; reply.RequestId = 6;
            if (KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0, 0)) return 28;
            reply.RequestId = 5; failed = fresh;
            if (KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0, 1)) return 29;
            if (!KalkanCoverReply(&fresh, &request, request.Size, &reply, sizeof(reply), 0, 0) ||
                !KalkanCoverageAllows(&fresh)) return 30;
            failed = (KALKAN_COVERAGE){0}; reply.Flags = 0;
            if (!KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0, 0) ||
                KalkanCoverageAllows(&failed)) return 34;
            failed = (KALKAN_COVERAGE){0}; reply.Flags = 2;
            if (KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0, 0) ||
                !failed.Invalid) return 35;
            failed = (KALKAN_COVERAGE){0}; reply.Flags = KALKAN_RESULT_PARSER_COMPLETE;
            request.ContentLength = 4; request.Size = sizeof(request) + 4;
            if (KalkanCoverReply(&failed, &request, request.Size, &reply, sizeof(reply), 0, 0) ||
                !failed.Invalid || KalkanCoverageAllows(&failed)) return 36;
            puts("PASS missing, unknown and premature parser completion cannot allow a file");
            puts("PASS coverage advances only after matching, timely successful reply");
        }
    }
    return 0;
}
