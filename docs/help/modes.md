# Calculation modes and noise

At the top of **SHOTS**, choose **Direct Calculation** or **Simulated
Measurements**. The active toggle is cyan. Neither mode connects to a physical
quantum computer. The choice applies to STATE, PROB, BLOCH and supported LAB
analyses as well as SHOTS.

Enable noise independently in **LAB → Noise & error → Noise model**. Turning
noise on does not select Simulated Measurements.

## With noise enabled

| Result | Direct Calculation | Simulated Measurements |
|---|---|---|
| State calculation | Computes the noisy state using a density matrix or averaged trajectories. | Uses that noisy model to generate simulated measurement results. |
| PROB and BLOCH | Calculated from the noisy state. | Estimated from a finite number of measurement shots. |
| STATE | Shows the computed density matrix, where supported. | Reconstructs a density matrix through simulated tomography, where supported. |
| Uncertainty | Trajectory approximation can introduce sampling error. | Measurement shots add statistical uncertainty. |
| SHOTS | Samples measurement outcomes. | Also samples measurement outcomes. |

SHOTS samples in both modes. The main difference is how the other panels obtain
their results. Direct noisy STATE supports up to 8 qubits; full tomography up to
6. Other panels have their own size and work limits. Result labels identify the
method and any approximation.

## Repeated runs

**Auto-repeat** and **rate** (runs per second) work in either mode, with or
without noise. Repetition preserves the selected mode, including when you stop
it or reload a saved session. It continues when you change tabs. Slow
calculations finish before the next run is scheduled.

Use **Sample shots** in Direct Calculation or **Run once** in Simulated
Measurements for one new sample. Exact calculated quantities do not fluctuate
between repeats. SHOTS counts can fluctuate because they are samples; a fixed
trajectory approximation can also repeat identically rather than being a new
noise realization on every run.

The noise indicator and experiment controls appear only in SHOTS. Noise
settings remain in LAB. In Simulated Measurements with noise, **Readout mitigation** corrects the measurement counts using the configured readout confusion
matrix; it does not remove gate noise, and it can amplify statistical error.
