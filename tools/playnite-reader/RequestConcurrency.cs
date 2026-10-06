namespace Vgcm.PlayniteReader;

// No request queue and no unbounded Task.Run fan-out. Slow disk reads never run
// on the listener's accept loop. A rejected request must receive a busy response.
internal sealed class BoundedRequestDispatcher
{
    private readonly SemaphoreSlim _slots;
    internal BoundedRequestDispatcher(int maximumRequests)
    {
        if (maximumRequests is < 1 or > 64) throw new ArgumentOutOfRangeException(nameof(maximumRequests));
        _slots = new SemaphoreSlim(maximumRequests, maximumRequests);
    }

    internal bool TryDispatch(Func<Task> handler, Action<Exception> onError, out Task completion)
    {
        if (!_slots.Wait(0)) { completion = Task.CompletedTask; return false; }
        completion = Task.Run(async () =>
        {
            try { await handler(); }
            catch (Exception ex) { onError(ex); }
            finally { _slots.Release(); }
        });
        return true;
    }
}

internal sealed class SingleFlight
{
    private int _busy;
    internal bool IsBusy => Volatile.Read(ref _busy) != 0;
    internal IDisposable? TryAcquire() => Interlocked.CompareExchange(ref _busy, 1, 0) == 0 ? new Lease(this) : null;
    private sealed class Lease(SingleFlight owner) : IDisposable
    {
        private SingleFlight? _owner = owner;
        public void Dispose()
        {
            var current = Interlocked.Exchange(ref _owner, null);
            if (current != null) Volatile.Write(ref current._busy, 0);
        }
    }
}
