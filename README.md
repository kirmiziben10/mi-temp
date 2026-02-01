# Mi Temperature Monitor - Web Bluetooth App

A modern, responsive React application to connect to **Xiaomi Mi Temperature and Humidity Monitor 2** (LYWSD03MMC) devices directly from your browser using the Web Bluetooth API.

## 🌟 Features

*   **Web Bluetooth Connectivity**: Connect directly to your device without custom firmware (works with stock firmware!).
*   **Real-time Monitoring**: Live updates for Temperature and Humidity.
*   **Comfort Indicator**: Visual comfort status:
    *   `(^_^)` Comfortable (19-27°C & 20-85% Humidity)
    *   `(-^-)` Uncomfortable (Custom styling for quick recognition)
*   **Battery Status**: View the current battery level of your device.
*   **Theme Support**: 
    *   Toggle between **Light** and **Dark** modes.
    *   Theme preference persists across reloads (saved in LocalStorage).
    *   Smooth transitions without page-load flash.
*   **Responsive Design**:
    *   **Mobile**: dedicated full-screen layout with easy navigation.
    *   **Desktop**: Side-by-side view with smooth "tweening" animations.
*   **Developer Console**:
    *   Inspect raw hexadecimal data from the device.
    *   View interpreted values and connection logs.
    *   Smooth reveal animations with overlay-free layout.

## 🚀 Getting Started

### Prerequisites

*   A browser that supports the [Web Bluetooth API](https://caniuse.com/web-bluetooth) (Chrome, Edge, Opera).
*   Bluetooth enabled on your device.

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/kirmiziben10/mi-temp.git
    ```
2.  Navigate to the directory:
    ```bash
    cd mi-temp
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Start the development server:
    ```bash
    npm run dev
    ```

## 🛠️ Tech Stack

*   [React](https://reactjs.org/) 19
*   [Vite](https://vitejs.dev/)
*   [Tailwind CSS](https://tailwindcss.com/) v4
*   [Recharts](https://recharts.org/)
*   [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

## 👏 Credits & Acknowledgements

**Special thanks to [atc1441/ATC_MiThermometer](https://github.com/atc1441/ATC_MiThermometer)**.

This project relies on the Bluetooth protocol documentation and logic provided by the ATC_MiThermometer repo. The understanding of the service UUIDs (`ebe0ccb0...`) and data parsing logic (decrypting the chaotic byte order of the stock firmware) is credited to their excellent work.

---
*Note: This app works with the stock firmware. Flashing custom firmware is supported but not required.*
