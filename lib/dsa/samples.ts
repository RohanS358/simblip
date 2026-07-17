// Starter program for a fresh DSA Lab block: shows an array being sorted
// (watch the cells swap), a recursive function (watch the tree grow), and
// console output — the three things the visualizer teaches.

export const DEFAULT_DSA_SOURCE = `#include <iostream>
using namespace std;

int fib(int n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

int main() {
  int a[6] = {5, 2, 8, 1, 9, 3};
  int n = 6;

  // bubble sort — watch the array cells swap
  for (int i = 0; i < n - 1; i++) {
    for (int j = 0; j < n - 1 - i; j++) {
      if (a[j] > a[j + 1]) {
        int t = a[j];
        a[j] = a[j + 1];
        a[j + 1] = t;
      }
    }
  }

  cout << "sorted!" << endl;
  cout << "fib(6) = " << fib(6) << endl;
  return 0;
}
`
