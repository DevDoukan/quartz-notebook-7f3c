#ifndef KALKAN_SCAN_CONTEXT_H
#define KALKAN_SCAN_CONTEXT_H
/* Paging/recursive filesystem paths cannot synchronously wait for a user
   scanner or perform another cached read. Caller must deny or use a separately
   proven cache path; never interpret this result as permission to skip DLP. */
static __inline int KalkanCanScanContext(unsigned long irql, int apcsDisabled,
    int topLevelRequest, int pagingIo)
{
    return irql == 0 && !apcsDisabled && !topLevelRequest && !pagingIo;
}
#endif
