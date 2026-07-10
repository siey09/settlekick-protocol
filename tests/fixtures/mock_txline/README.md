# Local Mock TxLINE Program

This fixture is used only for local LiteSVM CPI tests.

It does not verify real TxLINE proofs and must never be deployed or treated as
evidence that the real TxLINE devnet CPI has succeeded.

The first byte of the supplied mock daily-root account controls its return:

- `1` returns validation success
- `0` returns validation rejection
- any other value returns an error
