import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const n = run('mlp', {}), and = run('perceptron', { data: '0,0,0;0,1,0;1,0,0;1,1,1' })
  return lesson({
    title: 'Perceptrons and backpropagation',
    kicker: 'ENCT 351 · Artificial Intelligence · Chapter 5',
    subtitle: 'One neuron draws a line. Stack layers and the network can draw any boundary — if you can train it.',
    sections: [
      sec('neuron', '5.1', 'The artificial neuron', { eyebrow: 'Building block',
        body: `<p>A neuron computes a weighted sum of its inputs plus a bias, z = Σ wᵢxᵢ + b, then applies an ${term('activation function')}: step (perceptron), sigmoid 1/(1+e⁻ᶻ), tanh, or ReLU max(0, z). Without a non-linearity, any stack of layers collapses into one linear map.</p>`,
        worked: [step('Inputs (1, 0), weights (0.5, −0.3), bias 0.1.', '', { toc: 'Given' }), step('z = 0.5·1 + (−0.3)·0 + 0.1 = 0.6; sigmoid(0.6) = 1/(1 + e⁻⁰·⁶).', '\\sigma(0.6)\\approx0.646', { hero: true, toc: 'Output' })],
        qs: [q('nonlin', 'Why do we need a non-linear activation?', ['Stacked linear layers are equivalent to a single linear layer.', 'Non-linearity is what gives depth its power.'], [['To make numbers smaller.', 'Not the reason.'], ['To avoid bias terms.', 'Unrelated.']])] }),
      sec('perc', '5.2', 'What one neuron can and cannot do', { eyebrow: 'Linear separability',
        body: `<p>A perceptron’s decision boundary is a straight line (hyperplane). It learns AND (converged: <b>${and.converged}</b>) but cannot learn XOR — Minsky and Papert’s 1969 observation which stalled the field. The cure is a hidden layer.</p>`,
        figs: [lab('perceptron', { data: '0,0,0;0,1,0;1,0,0;1,1,1' }, 'AND is linearly separable.', ['converged'], { caption: 'AND', name: 'and' }), lab('perceptron', { data: '0,0,0;0,1,1;1,0,1;1,1,0', epochs: 20 }, 'XOR is not.', ['converged'], { caption: 'XOR', name: 'xor' })],
        qs: [q('xor', 'Why can a single perceptron not compute XOR?', ['No straight line separates {(0,1),(1,0)} from {(0,0),(1,1)}.', 'A hidden layer combines two lines.'], [['It has too few inputs.', 'Two inputs are enough for AND.'], ['XOR is undefined.', 'It is well defined.']])] }),
      sec('mlp', '5.3', 'Multilayer networks and backpropagation', { eyebrow: 'Training',
        body: `<p>A ${term('multilayer perceptron')} has hidden layers between input and output. ${term('Backpropagation')} trains it: (1) forward pass computes the output; (2) the loss measures the error; (3) the chain rule sends the error gradient backwards, layer by layer, giving ∂L/∂w for every weight; (4) gradient descent updates w ← w − η ∂L/∂w. Run the 2-3-1 network on XOR: the loss falls to <b>${n.loss}</b> and all four outputs are right (<b>${n.solved}</b>).</p>`,
        figs: [lab('mlp', {}, 'Line thickness is |weight|; watch the loss curve fall.', ['loss', 'solved'], { caption: 'learning XOR', name: 'mlp' })],
        worked: [step('Output unit: y = σ(z), loss E = ½(y − t)². Its error signal is δ = (y − t)·y(1 − y).', '\\delta_o=(y-t)\\,y(1-y)', { toc: 'Output delta' }), step('For a hidden unit h the signal is passed back through the weight: δ_h = δ_o · w · h(1 − h).', '\\delta_h=\\delta_o\\,w\\,h(1-h)', { toc: 'Hidden delta' }), step('Each weight moves against its gradient: Δw = −η δ · (input to that weight).', '\\Delta w=-\\eta\\,\\delta\\,x', { hero: true, toc: 'Update' })],
        qs: [q('bp', 'Backpropagation computes…', ['The gradient of the loss with respect to every weight, using the chain rule backwards.', 'The update then follows by gradient descent.'], [['The forward output only.', 'That is the forward pass.'], ['The best learning rate.', 'Not part of it.']])],
        probs: [pr('p-mlp', '<p>After training, do all four XOR inputs give outputs on the correct side of 0.5?</p>', `Yes: the trained network reports solved = <b>${n.solved}</b> with loss ${n.loss}.`)] }),
      sec('deep', '5.4', 'Deep learning and architectures', { eyebrow: 'Going further',
        body: `<p>${term('Deep learning')} uses many layers that learn features automatically. Convolutional networks share small filters across an image (translation-invariant features); recurrent networks carry a hidden state through a sequence; transformers replace recurrence with attention. Universal approximation: one hidden layer of enough units can approximate any continuous function — depth makes it efficient. Generative networks (GANs, diffusion models, language models) create new data.</p>`,
        figs: [dia(`direction: right
[Input image] as i #blue
[Convolution + ReLU] as c #mint
[Pooling] as p #amber
[Fully connected] as f #violet
(Class scores) as o
i -> c : filters
c -> p : downsample
p -> f : flatten
f -> o
@0 i -> c : pixels
@1 c -> p : feature maps
@2 p -> f : summary
@3 f -> o : scores
loop 5`, 'A convolutional classifier in four stages.', { caption: 'a CNN pipeline' })],
        qs: [q('cnn', 'Why do convolutional layers suit images?', ['They reuse the same small filter everywhere, detecting a feature wherever it appears.', 'Few parameters, translation invariance.'], [['They ignore pixel neighbourhoods.', 'They exploit them.'], ['They need no training.', 'Filters are learned.']])] }),
      sec('summary', '5.5', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Neuron = weighted sum + activation; a single neuron separates linearly only.</li><li>Hidden layers + backpropagation solve XOR and far more.</li></ul>` }),
      sec('ex', '5.6', 'Try it', { eyebrow: 'Practice',
        body: `<p>In the card below set <em>units</em> to 2 and then 1 and see what happens to the loss: how many hidden units does XOR need?</p>`,
        figs: [lab('mlp', { units: 2, epochs: 4000 }, 'Two hidden units can solve XOR — but some random starts get stuck in a local minimum (try seed 3).', ['loss'], { caption: 'two hidden units', name: 'h2' })],
        qs: [q('h1', 'A network with ONE hidden unit and a sigmoid output on XOR…', ['Cannot reach zero error: a single hidden unit gives only one new feature.', 'XOR needs at least two hidden units.'], [['Always solves it.', 'It cannot.'], ['Is identical to a perceptron.', 'Nearly, for this problem.']])] }),
    ],
  })
}
