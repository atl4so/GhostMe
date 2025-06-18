# Getting started

Make sure you have the latest version of git downloaded - https://git-scm.com/downloads

Verify your installation by running in your terminal:
```
git version
```
Install Rust locally and run: 
```
cargo install wasm-pack
```

## Clone the repository
```
git clone https://github.com/K-Kluster/Kasia.git
```
```
cd Kasia
```

## Build the cipher wasm package

```
cd cipher
```
```
wasm-pack build --target web --release -d ../cipher-wasm
```
```
cd ..
```

## Install Node.js 
Download Node.js: https://nodejs.org/en/download

## Install Kaspa WASM Files

- Download the latest `kaspa-wasm32-sdk-v1.0.0.zip` or build the [WASM precompiled binaries](https://github.com/kaspanet/rusty-kaspa/releases) yourself.
- Extract the contents of `kaspa-wasm32-sdk/web/kaspa` into the `Kasia/wasm` directory.

## Run Kasia Locally
```
npm install
```
```
npm run dev
```
