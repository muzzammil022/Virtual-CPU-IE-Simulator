export interface CodeSample {
  name: string;
  description: string;
  code: string;
}

export const SAMPLE_CODES: CodeSample[] = [
  {
    name: "Obstacle Avoidance",
    description: "Simple branching control — mirrors the car demo logic",
    code: `#include <stdio.h>

// Obstacle avoidance control
// All branches statically bounded
// No dynamic memory, no unbounded loops

int steer = 0;
int brake = 0;

void control(float distance, float speed, int lane) {
    if (distance < 5.0) {
        if (lane == 0) {
            steer = 1;   // change lane right
        } else {
            brake = 1;   // emergency brake
        }
    }
}

int main() {
    float distance = 3.2;
    float speed = 10.0;
    int lane = 0;

    control(distance, speed, lane);

    if (steer) {
        printf("Action: STEER\\n");
    } else if (brake) {
        printf("Action: BRAKE\\n");
    } else {
        printf("Action: NONE\\n");
    }

    return 0;
}`,
  },
  {
    name: "PID Controller",
    description: "Bounded PID loop — fixed iteration count for WCET analysis",
    code: `#include <stdio.h>

// Bounded PID controller
// Fixed iteration count: exactly 10 steps
// No dynamic allocation, all paths bounded

#define STEPS 10
#define KP 0.5
#define KI 0.1
#define KD 0.05
#define SETPOINT 100.0

int main() {
    float error = 0.0;
    float integral = 0.0;
    float prev_error = 0.0;
    float measurement = 20.0;
    float output = 0.0;

    // Bounded loop: exactly STEPS iterations
    for (int i = 0; i < STEPS; i++) {
        error = SETPOINT - measurement;
        integral = integral + error;
        float derivative = error - prev_error;

        output = KP * error + KI * integral + KD * derivative;

        prev_error = error;
        measurement = measurement + output * 0.1;
    }

    printf("Final output: %f\\n", output);
    printf("Final measurement: %f\\n", measurement);
    return 0;
}`,
  },
  {
    name: "Sensor Fusion",
    description: "Fixed-size array processing — deterministic sensor data merge",
    code: `#include <stdio.h>

// Sensor fusion for 4 sensors
// Fixed array sizes, bounded loops
// Suitable for WCET analysis

#define NUM_SENSORS 4

float sensors[NUM_SENSORS] = {12.5, 13.1, 11.8, 12.9};
float weights[NUM_SENSORS] = {0.3, 0.25, 0.25, 0.2};

float fused_value() {
    float result = 0.0;
    // Bounded loop: exactly NUM_SENSORS iterations
    for (int i = 0; i < NUM_SENSORS; i++) {
        result = result + sensors[i] * weights[i];
    }
    return result;
}

int classify(float value) {
    if (value < 10.0) return 0;  // LOW
    if (value < 15.0) return 1;  // NORMAL
    return 2;                     // HIGH
}

int main() {
    float fused = fused_value();
    int level = classify(fused);

    printf("Fused: %f\\n", fused);
    printf("Level: %d\\n", level);
    return 0;
}`,
  },
  {
    name: "Empty Template",
    description: "Start from scratch — write your own time-predictable C code",
    code: `#include <stdio.h>

// Write time-predictable C code here
// Rules:
//   - No dynamic memory (malloc/calloc)
//   - Bounded loops only (fixed iteration count)
//   - No recursion
//   - All branches must be statically analyzable

int main() {
    // Your code here

    printf("Hello from Patmos!\\n");
    return 0;
}`,
  },
];
