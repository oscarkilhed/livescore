#!/bin/bash

echo "Cleaning node_modules from server..."
rm -rf src/server/node_modules

echo "Cleaning node_modules from client..."
rm -rf src/client/node_modules

echo "Clean complete!" 